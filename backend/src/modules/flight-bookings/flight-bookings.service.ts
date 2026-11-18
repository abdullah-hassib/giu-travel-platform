import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession, Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';

import { Flight } from '../flights/schemas/flight.schema';
import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../reference-data/schemas/airport.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { PrepareFlightBookingDto } from './dto/prepare-flight-booking.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { calculateFlightPassengerPricing } from './utils/flight-passenger-pricing.util';

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<any>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<any>,
    @InjectModel(Airport.name) private readonly airportModel: Model<any>,
    @InjectModel(FlightBooking.name)
    private readonly flightBookingModel: Model<any>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async prepareBooking(
    dto: PrepareFlightBookingDto,
    session?: ClientSession,
  ) {
    if (!Types.ObjectId.isValid(dto.flightId)) {
      throw new BadRequestException('Invalid flight ID');
    }

    const flightQuery = this.flightModel.findById(dto.flightId);
    if (session) flightQuery.session(session);
    const flight = await flightQuery.lean<any>();

    if (!flight) {
      throw new NotFoundException('Flight not found');
    }

    if (flight.status !== 'Scheduled') {
      throw new BadRequestException(
        'This flight is not available for booking',
      );
    }

    if (!(flight.departureAt instanceof Date) || flight.departureAt <= new Date()) {
      throw new BadRequestException(
        'This flight has already departed or is unavailable',
      );
    }

    const airlineQuery = this.airlineModel.findById(flight.airlineId);
    if (session) airlineQuery.session(session);
    const airline = await airlineQuery.lean<any>();

    if (!airline || String(airline.status).toLowerCase() !== 'active') {
      throw new BadRequestException(
        'This airline is not available for booking',
      );
    }

    const cabin = flight.cabins?.find(
      (item: any) => item.category === dto.cabinCategory,
    );

    if (!cabin) {
      throw new BadRequestException(
        'The selected cabin is not available on this flight',
      );
    }

    const departureAirportQuery = this.airportModel.findById(
      flight.departureAirportId,
    );
    if (session) departureAirportQuery.session(session);
    const departureAirport = await departureAirportQuery.lean<any>();

    const arrivalAirportQuery = this.airportModel.findById(
      flight.arrivalAirportId,
    );
    if (session) arrivalAirportQuery.session(session);
    const arrivalAirport = await arrivalAirportQuery.lean<any>();

    if (!departureAirport || !arrivalAirport) {
      throw new BadRequestException(
        'Flight airport reference data is unavailable',
      );
    }

    const baggagePolicy = airline.baggagePolicy;

    if (
      !baggagePolicy ||
      !Number.isFinite(Number(baggagePolicy.extraBagPrice)) ||
      Number(baggagePolicy.extraBagPrice) <= 0 ||
      !Number.isInteger(Number(baggagePolicy.maxExtraBags)) ||
      Number(baggagePolicy.maxExtraBags) < 0
    ) {
      throw new BadRequestException(
        'Airline baggage policy is invalid or unavailable',
      );
    }

    const extraBagPriceMinor = Math.round(
      Number(baggagePolicy.extraBagPrice) * 100,
    );
    const maxExtraBags = Number(baggagePolicy.maxExtraBags);

    const pricing = calculateFlightPassengerPricing({
      passengers: dto.passengers.map((passenger) => ({
        fullName: passenger.fullName,
        dateOfBirth: passenger.dateOfBirth,
        identityDocumentNumber: passenger.identityDocumentNumber,
        extraBags: passenger.extraBags ?? 0,
      })),
      departureLocalDate: flight.departureLocalDate,
      cabinPriceMinor: cabin.price,
      extraBagPriceMinor,
      maxExtraBags,
    });

    return {
      flight: {
        id: flight._id.toString(),
        flightNumber: flight.flightNumber,
        departureAirport: {
          id: departureAirport._id.toString(),
          iataCode: departureAirport.iataCode,
          name: departureAirport.name,
          cityId: departureAirport.cityId,
          countryCode: departureAirport.countryCode,
        },
        arrivalAirport: {
          id: arrivalAirport._id.toString(),
          iataCode: arrivalAirport.iataCode,
          name: arrivalAirport.name,
          cityId: arrivalAirport.cityId,
          countryCode: arrivalAirport.countryCode,
        },
        departureAt: flight.departureAt,
        arrivalAt: flight.arrivalAt,
        departureLocalDate: flight.departureLocalDate,
        status: flight.status,
      },
      airline: {
        id: airline._id.toString(),
        name: airline.name,
        code: airline.code,
      },
      cabin: {
        category: cabin.category,
        priceMinor: cabin.price,
        freeBags: cabin.freeBags,
        maxWeightPerBag: cabin.maxWeightPerBag,
        seatsAvailable: Math.max(
          0,
          cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
        ),
      },
      baggagePolicy: {
        extraBagPriceMinor,
        maxExtraBags,
      },
      passengers: pricing.passengers,
      pricing: {
        passengerCount: pricing.passengerCount,
        seatsRequired: pricing.seatsRequired,
        totalBaseFareMinor: pricing.totalBaseFareMinor,
        totalExtraBaggageFeeMinor:
          pricing.totalExtraBaggageFeeMinor,
        totalAmountMinor: pricing.totalAmountMinor,
        currency: 'USD',
      },
      booking: {
        status: 'Not created',
        seatsReserved: false,
        holdCreated: false,
      },
    };
  }

  async holdBooking(dto: HoldFlightBookingDto, userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid authenticated user');
    }

    const session = await this.connection.startSession();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    try {
      session.startTransaction();

      const prepared = await this.prepareBooking(dto, session);
      const seatsRequired = prepared.pricing.seatsRequired;

      // Infants are excluded by the pricing utility. Only actual seat
      // occupants are reserved in the cabin inventory.
      const selectedCabinExpression = {
        $let: {
          vars: {
            selectedCabin: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: '$cabins',
                    as: 'cabin',
                    cond: {
                      $eq: ['$$cabin.category', dto.cabinCategory],
                    },
                  },
                },
                0,
              ],
            },
          },
          in: {
            $subtract: [
              '$$selectedCabin.totalSeats',
              {
                $add: [
                  '$$selectedCabin.bookedSeats',
                  '$$selectedCabin.heldSeats',
                ],
              },
            ],
          },
        },
      };

      // Atomic conditional update: reservation succeeds only if sufficient
      // seats remain at the exact moment this update is executed.
      const reservedFlight = await this.flightModel.findOneAndUpdate(
        {
          _id: dto.flightId,
          status: 'Scheduled',
          departureAt: { $gt: now },
          'cabins.category': dto.cabinCategory,
          $expr: {
            $gte: [selectedCabinExpression, seatsRequired],
          },
        },
        {
          $inc: {
            'cabins.$.heldSeats': seatsRequired,
          },
        },
        {
          new: true,
          session,
        },
      );

      if (!reservedFlight) {
        throw new BadRequestException(
          'Not enough seats are available in the selected cabin',
        );
      }

      const bookingReference = `GT-${randomBytes(5).toString('hex').toUpperCase()}`;

      const passengers = prepared.passengers.map((passenger: any) => ({
        fullName: passenger.fullName,
        dateOfBirth: passenger.dateOfBirth,
        passengerType: passenger.passengerType,
        identityDocumentNumber: passenger.identityDocumentNumber,
        extraBags: passenger.extraBags,
        extraBaggageFeeMinor: passenger.extraBaggageFeeMinor,
      }));

      const bookingSegment = {
        flightId: new Types.ObjectId(prepared.flight.id),
        airlineId: new Types.ObjectId(prepared.airline.id),
        flightNumber: prepared.flight.flightNumber,
        departureAirportCode: prepared.flight.departureAirport.iataCode,
        arrivalAirportCode: prepared.flight.arrivalAirport.iataCode,
        departureAt: prepared.flight.departureAt,
        arrivalAt: prepared.flight.arrivalAt,
        cabinCategory: dto.cabinCategory,
        seatsReserved: seatsRequired,
        baseFareMinor: prepared.pricing.totalBaseFareMinor,
        segmentTotalMinor: prepared.pricing.totalAmountMinor,
      };

      const [booking] = await this.flightBookingModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            bookingReference,
            status: 'Pending Payment',
            segments: [bookingSegment],
            passengers,
            totalAmountMinor: prepared.pricing.totalAmountMinor,
            currency: 'USD',
            holdExpiresAt,
            policiesAcceptedAt: null,
          },
        ],
        { session },
      );

      await session.commitTransaction();

      return {
        message: 'Flight seats held successfully',
        booking: booking.toJSON(),
        hold: {
          expiresAt: holdExpiresAt,
          durationMinutes: 10,
        },
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

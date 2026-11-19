import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model } from 'mongoose';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  BookingPassenger,
  FlightBooking,
} from './schemas/flight-booking.schema';
import { FlightTicketData, renderFlightTicket } from './flight-eticket.pdf';

type TicketBooking = Pick<
  FlightBooking,
  | 'bookingReference'
  | 'status'
  | 'segments'
  | 'totalAmountMinor'
  | 'currency'
  | 'policySnapshot'
> & {
  passengers: Pick<
    BookingPassenger,
    'fullName' | 'passengerType' | 'extraBags' | 'extraBagWeightsKg'
  >[];
};

@Injectable()
export class FlightEticketService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly references: ReferenceDataService,
  ) {}

  async download(ownerId: string, id: string): Promise<Buffer> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: ownerId })
      .select({
        _id: 0,
        bookingReference: 1,
        status: 1,
        segments: 1,
        totalAmountMinor: 1,
        currency: 1,
        policySnapshot: 1,
        'passengers.fullName': 1,
        'passengers.passengerType': 1,
        'passengers.extraBags': 1,
        'passengers.extraBagWeightsKg': 1,
      })
      .lean<TicketBooking>();
    if (!booking) throw new NotFoundException('Booking not found');
    if (!['Confirmed', 'Completed'].includes(booking.status))
      throw new ConflictException(
        'E-tickets are available only for confirmed bookings',
      );
    const segments: FlightTicketData['segments'] = [];
    for (const segment of booking.segments) {
      const [from, to] = await Promise.all([
        this.references.getAirport(segment.departureAirportCode),
        this.references.getAirport(segment.arrivalAirportCode),
      ]);
      const local = (instant: Date, zone: string) =>
        DateTime.fromJSDate(instant)
          .setZone(zone)
          .toFormat('yyyy-MM-dd HH:mm ZZ') +
        ' (' +
        zone +
        ')';
      const baggage = booking.policySnapshot.baggage.find(
        (row) => row.segmentId === segment.flightId.toString(),
      );
      segments.push({
        airline: segment.airlineName,
        number: segment.flightNumber,
        from: from.iata_code + ' - ' + from.name,
        to: to.iata_code + ' - ' + to.name,
        departure: local(segment.departureAt, from.time_zone),
        arrival: local(segment.arrivalAt, to.time_zone),
        cabin: segment.cabinCategory,
        seats: segment.seatsReserved,
        bags: baggage
          ? 'Included bags per passenger: ' +
            baggage.freeBagCount +
            '  |  Maximum per bag: ' +
            baggage.maxWeightKg +
            ' kg'
          : 'Baggage details: consult the saved booking policies',
      });
    }
    return renderFlightTicket({
      reference: booking.bookingReference,
      totalAmountMinor: booking.totalAmountMinor,
      currency: booking.currency,
      segments,
      passengers: booking.passengers.map((row) => ({
        name: row.fullName,
        type: row.passengerType,
        extraBags: row.extraBags,
        weights: row.extraBagWeightsKg ?? [],
      })),
    });
  }
}

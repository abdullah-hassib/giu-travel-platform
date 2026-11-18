import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { DateTime } from 'luxon';
import { AirlinesService } from '../airlines/airlines.service';
import { DomainEventPublisherService } from '../domain-events/domain-event-publisher.service';
import { publishEffects } from '../domain-events/publish-effects';
import { FlightPaymentAdapter } from '../flight-bookings/flight-payment.adapter';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { RefundsService } from '../refunds/refunds.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { airportLocalTimeToUtc } from '../../common/utils/airport-timezone.util';
import { Flight } from './schemas/flight.schema';
import { CabinCategory } from './schemas/flight-cabin.schema';
import { CreateFlightCabinDto } from './dto/create-flight-cabin.dto';
import {
  UpdateFlightCabinDto,
  UpdateFlightDto,
} from './dto/flight-management.dto';

@Injectable()
export class FlightOperationsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly ownership: AirlinesService,
    private readonly reference: ReferenceDataService,
    private readonly inventory: FlightPaymentAdapter,
    private readonly refunds: RefundsService,
    private readonly events: DomainEventPublisherService,
  ) {}

  private async scheduled(userId: string, id: string, session: ClientSession) {
    const flight = await this.flights.findById(id).session(session).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    await this.ownership.assertAssigned(userId, flight.airlineId.toString());
    if (flight.status !== 'Scheduled' || flight.departureAt <= new Date())
      throw new ConflictException(
        'Only future Scheduled flights can be changed',
      );
    return flight;
  }

  async update(userId: string, id: string, dto: UpdateFlightDto) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('Provide a flight field to change');
    try {
      return await this.connection.transaction(async (session) => {
        const flight = await this.scheduled(userId, id, session);
        const [departure, arrival] = await Promise.all([
          this.reference.getAirport(
            dto.departureAirportCode ?? flight.departureAirportId,
          ),
          this.reference.getAirport(
            dto.arrivalAirportCode ?? flight.arrivalAirportId,
          ),
        ]);
        if (departure.iata_code === arrival.iata_code)
          throw new BadRequestException(
            'Departure and arrival airports must differ',
          );
        const airportsChanged =
          departure.iata_code !== flight.departureAirportId ||
          arrival.iata_code !== flight.arrivalAirportId;
        if (
          airportsChanged &&
          (await this.bookings
            .exists({ 'segments.flightId': flight._id })
            .session(session))
        )
          throw new ConflictException(
            'Airports cannot change once a flight has any booking',
          );
        const departureAt = dto.departureLocalDateTime
          ? airportLocalTimeToUtc(
              dto.departureLocalDateTime,
              departure.time_zone,
            )
          : flight.departureAt;
        const arrivalAt = dto.arrivalLocalDateTime
          ? airportLocalTimeToUtc(dto.arrivalLocalDateTime, arrival.time_zone)
          : flight.arrivalAt;
        if (departureAt <= new Date() || arrivalAt <= departureAt)
          throw new BadRequestException(
            'Departure must be future and arrival after departure',
          );
        const departureLocalDate = DateTime.fromJSDate(departureAt, {
          zone: departure.time_zone,
        }).toISODate()!;
        const timeChanged =
          departureAt.getTime() !== flight.departureAt.getTime() ||
          arrivalAt.getTime() !== flight.arrivalAt.getTime();
        if (!airportsChanged && !timeChanged) return flight;
        const activeBookings = await this.bookings
          .find({
            'segments.flightId': flight._id,
            status: { $in: ['Pending Payment', 'Confirmed'] },
          })
          .select('segments userId status')
          .session(session)
          .lean();
        for (const booking of activeBookings) {
          if (booking.segments.length !== 2) continue;
          const times = booking.segments.map((segment) =>
            segment.flightId.toString() === id
              ? { departureAt, arrivalAt }
              : segment,
          );
          if (times[1].departureAt <= times[0].arrivalAt)
            throw new ConflictException(
              'Schedule would invalidate an active round-trip booking',
            );
        }
        const updated = await this.flights.findOneAndUpdate(
          { _id: id, status: 'Scheduled', departureAt: { $gt: new Date() } },
          {
            $set: {
              departureAirportId: departure.iata_code,
              arrivalAirportId: arrival.iata_code,
              departureAt,
              arrivalAt,
              departureLocalDate,
            },
            $inc: { __v: 1 },
          },
          { new: true, runValidators: true, session },
        );
        if (!updated)
          throw new ConflictException('Flight is no longer Scheduled');
        const affected = timeChanged
          ? activeBookings.filter((booking) => booking.status === 'Confirmed')
          : [];
        // Active bookings follow the current schedule; ended history keeps its
        // booked dates. Saved passenger pricing and policies remain frozen.
        await this.bookings.updateMany(
          {
            'segments.flightId': flight._id,
            status: { $in: ['Pending Payment', 'Confirmed'] },
          },
          {
            $set: {
              'segments.$[segment].departureAt': departureAt,
              'segments.$[segment].arrivalAt': arrivalAt,
              'segments.$[segment].departureLocalDate': departureLocalDate,
              'segments.$[segment].departureAirportCode': departure.iata_code,
              'segments.$[segment].arrivalAirportCode': arrival.iata_code,
            },
          },
          { session, arrayFilters: [{ 'segment.flightId': flight._id }] },
        );
        await publishEffects(
          this.events,
          session,
          'flight.updated',
          userId,
          {
            action: 'flight.updated',
            resourceType: 'flight',
            resourceId: id,
            outcome: 'success',
          },
          [...new Set(affected.map((booking) => booking.userId.toString()))]
            .sort()
            .map((recipientId) => ({
              recipientId,
              eventType: 'flight.schedule_changed',
              resourceType: 'flight',
              resourceId: id,
              message:
                'Flight ' +
                flight.flightNumber +
                ' schedule changed. Departure ' +
                departureAt.toISOString() +
                ', arrival ' +
                arrivalAt.toISOString() +
                '. Check your updated booking details.',
            })),
        );
        return updated;
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw new ConflictException(
          'Duplicate flight number for the airline on this departure date',
        );
      throw error;
    }
  }

  async addCabin(userId: string, id: string, dto: CreateFlightCabinDto) {
    return this.connection.transaction(async (session) => {
      const flight = await this.scheduled(userId, id, session);
      if (flight.cabins.some((cabin) => cabin.category === dto.category))
        throw new ConflictException('Cabin category already exists');
      const updated = await this.flights.findOneAndUpdate(
        { _id: id, status: 'Scheduled', departureAt: { $gt: new Date() } },
        {
          $push: { cabins: { ...dto, heldSeats: 0, bookedSeats: 0 } },
          $inc: { __v: 1 },
        },
        { new: true, runValidators: true, session },
      );
      if (!updated)
        throw new ConflictException('Flight is no longer Scheduled');
      await this.cabinAudit(userId, id, session);
      return updated;
    });
  }

  async updateCabin(
    userId: string,
    id: string,
    category: CabinCategory,
    dto: UpdateFlightCabinDto,
  ) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('Provide a cabin field to change');
    return this.connection.transaction(async (session) => {
      const flight = await this.scheduled(userId, id, session);
      const cabin = flight.cabins.find((row) => row.category === category);
      if (!cabin) throw new NotFoundException('Cabin not found');
      if (
        dto.totalSeats !== undefined &&
        dto.totalSeats < cabin.bookedSeats + cabin.heldSeats
      )
        throw new ConflictException(
          'Seat count cannot be below booked plus held seats',
        );
      const set: Record<string, number> = {};
      if (dto.totalSeats !== undefined)
        set['cabins.$.totalSeats'] = dto.totalSeats;
      if (dto.price !== undefined) set['cabins.$.price'] = dto.price;
      const updated = await this.flights.findOneAndUpdate(
        {
          _id: id,
          status: 'Scheduled',
          departureAt: { $gt: new Date() },
          'cabins.category': category,
        },
        { $set: set, $inc: { __v: 1 } },
        { new: true, runValidators: true, session },
      );
      if (!updated)
        throw new ConflictException('Flight is no longer Scheduled');
      await this.cabinAudit(userId, id, session);
      return updated;
    });
  }

  private cabinAudit(userId: string, id: string, session: ClientSession) {
    return publishEffects(
      this.events,
      session,
      'flight.cabins_updated',
      userId,
      {
        action: 'flight.cabins_updated',
        resourceType: 'flight',
        resourceId: id,
        outcome: 'success',
      },
    );
  }

  async cancel(userId: string, id: string) {
    return this.connection.transaction(async (session) => {
      const flight = await this.scheduled(userId, id, session);
      const updated = await this.flights.findOneAndUpdate(
        { _id: id, status: 'Scheduled', departureAt: { $gt: new Date() } },
        { $set: { status: 'Cancelled' }, $inc: { __v: 1 } },
        { new: true, session },
      );
      if (!updated)
        throw new ConflictException('Flight is no longer Scheduled');
      const pending = await this.bookings
        .find({ 'segments.flightId': flight._id, status: 'Pending Payment' })
        .select('_id')
        .session(session)
        .lean();
      for (const booking of pending)
        await this.inventory.expireBooking(booking._id.toString(), session);
      const confirmed = await this.bookings
        .find({ 'segments.flightId': flight._id, status: 'Confirmed' })
        .session(session)
        .lean();
      for (const booking of confirmed) {
        const changed = await this.bookings
          .findOneAndUpdate(
            { _id: booking._id, status: 'Confirmed' },
            {
              $set: {
                status: 'Cancelled',
                cancelledAt: new Date(),
                refundPercent: 100,
                refundMinor: booking.totalAmountMinor,
              },
            },
            { new: true, session },
          )
          .lean();
        if (!changed || !changed.paymentId)
          throw new ConflictException(
            'Confirmed booking has no verified payment link',
          );
        await this.inventory.release(changed, 'bookedSeats', session);
        await this.refunds.enqueueCancellation(
          {
            paymentId: changed.paymentId,
            bookingId: changed._id.toString(),
            userId: changed.userId.toString(),
            amountMinor: changed.totalAmountMinor,
            reason: 'provider_cancellation',
          },
          session,
        );
        await publishEffects(
          this.events,
          session,
          'booking.cancelled',
          userId,
          {
            action: 'booking.cancelled',
            resourceType: 'flight-booking',
            resourceId: changed._id.toString(),
            outcome: 'success',
          },
          [
            {
              recipientId: changed.userId.toString(),
              eventType: 'flight.cancelled',
              resourceType: 'flight-booking',
              resourceId: changed._id.toString(),
              message:
                'Flight ' +
                flight.flightNumber +
                ' was cancelled. Your whole booking ' +
                changed.bookingReference +
                ' is Cancelled and a full refund has been requested.',
            },
          ],
        );
      }
      await publishEffects(this.events, session, 'flight.cancelled', userId, {
        action: 'flight.cancelled',
        resourceType: 'flight',
        resourceId: id,
        outcome: 'success',
        metadata: {
          cancelledBookings: confirmed.length,
          expiredHolds: pending.length,
        },
      });
      return {
        flight: updated,
        cancelledBookings: confirmed.length,
        expiredHolds: pending.length,
      };
    });
  }
}

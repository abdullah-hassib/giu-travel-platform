import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Flight } from '../flights/schemas/flight.schema';
import { Airline } from '../airlines/schemas/airline.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { calculateFlightPassengerPricing } from './utils/flight-passenger-pricing.util';
import { FlightPaymentAdapter } from './flight-payment.adapter';
import { assertPlatformMoney } from '../payments/platform-money';
import { RefundsService } from '../refunds/refunds.service';
import { refundPercent } from '../hotels/stay-rules';
import { DomainEventPublisherService } from '../domain-events/domain-event-publisher.service';
import { publishEffects } from '../domain-events/publish-effects';

@Injectable()
export class FlightBookingsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(FlightBookingsService.name);
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly reference: ReferenceDataService,
    private readonly settlement: FlightPaymentAdapter,
    private readonly refunds: RefundsService,
    private readonly events: DomainEventPublisherService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.pollExpiry(), 5_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private async pollExpiry(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.expireDue();
    } catch {
      this.logger.warn(
        'Flight expiry will retry; no partial inventory release committed',
      );
    } finally {
      this.running = false;
    }
  }

  async expireDue(): Promise<void> {
    const due = await this.bookings
      .find({
        status: 'Pending Payment',
        $or: [
          { holdExpiresAt: { $lte: new Date() } },
          { 'segments.departureAt': { $lte: new Date() } },
        ],
      })
      .sort({ holdExpiresAt: 1, _id: 1 })
      .limit(50)
      .select('_id')
      .lean();
    for (const booking of due)
      await this.connection.transaction(async (session) => {
        const current = await this.bookings
          .exists({
            _id: booking._id,
            status: 'Pending Payment',
            $or: [
              { holdExpiresAt: { $lte: new Date() } },
              { 'segments.departureAt': { $lte: new Date() } },
            ],
          })
          .session(session);
        if (current)
          await this.settlement.expireBooking(booking._id.toString(), session);
      });
  }

  private async prepareSegment(
    dto: HoldFlightBookingDto,
    flightId: string,
    cabinCategory: string,
    session?: ClientSession,
  ) {
    const flight = await this.flights
      .findById(flightId)
      .session(session ?? null)
      .lean();
    if (!flight) throw new NotFoundException('Flight not found');
    if (flight.status !== 'Scheduled' || flight.departureAt <= new Date())
      throw new ConflictException('Flight is not available for booking');
    const airline = await this.airlines
      .findById(flight.airlineId)
      .session(session ?? null)
      .lean();
    if (!airline || airline.status !== 'active')
      throw new NotFoundException('Active airline not found');
    const cabin = flight.cabins.find((row) => row.category === cabinCategory);
    if (!cabin)
      throw new BadRequestException('Cabin is not available on this flight');
    const airports = await Promise.all([
      this.reference.getAirport(flight.departureAirportId),
      this.reference.getAirport(flight.arrivalAirportId),
    ]);
    const baggage = airline.baggagePolicy;
    if (
      !baggage ||
      baggage.extraBagPrice <= 0 ||
      !Number.isSafeInteger(baggage.maxExtraBags) ||
      baggage.maxExtraBags < 0
    )
      throw new ConflictException(
        'Airline baggage policy must be configured before booking',
      );
    const extraBagPriceMinor = Math.round(baggage.extraBagPrice * 100);
    const pricing = calculateFlightPassengerPricing({
      passengers: dto.passengers.map((p) => ({
        fullName: p.fullName,
        dateOfBirth: p.dateOfBirth,
        identityDocumentNumber: p.identityDocumentNumber,
        extraBags: p.extraBags ?? 0,
      })),
      departureLocalDate: flight.departureLocalDate,
      cabinPriceMinor: cabin.price,
      extraBagPriceMinor,
      maxExtraBags: baggage.maxExtraBags,
    });
    dto.passengers.forEach((p) => {
      const weights = p.extraBagWeightsKg ?? [];
      if (
        weights.length !== (p.extraBags ?? 0) ||
        weights.some(
          (weight) =>
            !Number.isFinite(weight) ||
            weight <= 0 ||
            weight > cabin.maxWeightPerBag,
        )
      )
        throw new BadRequestException(
          'Provide one valid weight per extra bag within the cabin limit',
        );
    });
    return {
      flight,
      airline,
      cabin,
      pricing,
      airports,
      baggage: {
        segmentId: flightId,
        cabin: cabinCategory,
        freeBagCount: cabin.freeBags,
        maxWeightKg: cabin.maxWeightPerBag,
        extraBagPriceMinor,
        maxExtraBags: baggage.maxExtraBags,
      },
    };
  }

  private async quote(dto: HoldFlightBookingDto, session?: ClientSession) {
    if (dto.returnCabinCategory && !dto.returnFlightId)
      throw new BadRequestException('A return cabin needs a return flight');
    if (dto.returnFlightId === dto.flightId)
      throw new BadRequestException(
        'Return flight must differ from the outbound',
      );
    const outbound = await this.prepareSegment(
      dto,
      dto.flightId,
      dto.cabinCategory,
      session,
    );
    dto.passengers.forEach((p, i) => {
      if (
        p.passengerType &&
        p.passengerType !== outbound.pricing.passengers[i].passengerType
      )
        throw new BadRequestException(
          'Passenger type does not match date of birth at departure',
        );
    });
    const prepared = [outbound];
    if (dto.returnFlightId) {
      const inbound = await this.prepareSegment(
        dto,
        dto.returnFlightId,
        dto.returnCabinCategory ?? dto.cabinCategory,
        session,
      );
      if (
        inbound.flight.departureAirportId !==
          outbound.flight.arrivalAirportId ||
        inbound.flight.arrivalAirportId !==
          outbound.flight.departureAirportId ||
        inbound.flight.departureAt <= outbound.flight.arrivalAt
      )
        throw new BadRequestException(
          'Return flight must reverse the route and depart after outbound arrival',
        );
      prepared.push(inbound);
    }
    const totalAmountMinor = prepared.reduce(
      (sum, row) => sum + row.pricing.totalAmountMinor,
      0,
    );
    assertPlatformMoney(totalAmountMinor, 'USD');
    const segments = prepared.map(({ flight, airline, cabin, pricing }) => ({
      flightId: flight._id,
      airlineId: airline._id,
      airlineName: airline.name,
      flightNumber: flight.flightNumber,
      departureAirportCode: flight.departureAirportId,
      arrivalAirportCode: flight.arrivalAirportId,
      departureAt: flight.departureAt,
      arrivalAt: flight.arrivalAt,
      departureLocalDate: flight.departureLocalDate,
      cabinCategory: cabin.category,
      seatsReserved: pricing.seatsRequired,
      baseFareMinor: pricing.totalBaseFareMinor,
      segmentTotalMinor: pricing.totalAmountMinor,
    }));
    const passengers = outbound.pricing.passengers.map((p, i) => ({
      fullName: p.fullName,
      dateOfBirth: p.dateOfBirth,
      passengerType: p.passengerType,
      identityDocumentNumber: p.identityDocumentNumber,
      extraBags: p.extraBags,
      extraBagWeightsKg: dto.passengers[i].extraBagWeightsKg ?? [],
      extraBaggageFeeMinor: prepared.reduce(
        (sum, row) => sum + row.pricing.passengers[i].extraBaggageFeeMinor,
        0,
      ),
    }));
    return {
      prepared,
      segments,
      passengers,
      totalAmountMinor,
      currency: 'USD',
      policySnapshot: {
        type: 'flight' as const,
        cancellation: outbound.airline.cancellationPolicy.map((tier) => ({
          daysBefore: tier.daysBeforeDeparture,
          refundPercent: tier.refundPercentage,
        })),
        baggage: prepared.map((row) => row.baggage),
      },
    };
  }

  async prepareBooking(dto: HoldFlightBookingDto) {
    const quote = await this.quote(dto);
    return {
      segments: quote.segments,
      passengers: quote.passengers,
      totalAmountMinor: quote.totalAmountMinor,
      currency: quote.currency,
      policies: quote.policySnapshot,
      booking: {
        status: 'Not created',
        seatsReserved: false,
        holdCreated: false,
      },
    };
  }

  async holdBooking(dto: HoldFlightBookingDto, userId: string) {
    await this.expireDue();
    const booking = await this.connection.transaction(async (session) => {
      const quote = await this.quote(dto, session);
      for (const id of [
        ...new Set(quote.segments.map((s) => s.airlineId.toString())),
      ].sort()) {
        if (
          !(await this.airlines.findOneAndUpdate(
            { _id: id, status: 'active' },
            { $inc: { inventoryVersion: 1 } },
            { session },
          ))
        )
          throw new ConflictException('Airline is no longer active');
      }
      for (const segment of [...quote.segments].sort((a, b) =>
        a.flightId.toString().localeCompare(b.flightId.toString()),
      )) {
        const enoughSeats = {
          $let: {
            vars: {
              c: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$cabins',
                      as: 'c',
                      cond: { $eq: ['$$c.category', segment.cabinCategory] },
                    },
                  },
                  0,
                ],
              },
            },
            in: {
              $gte: [
                {
                  $subtract: [
                    '$$c.totalSeats',
                    { $add: ['$$c.bookedSeats', '$$c.heldSeats'] },
                  ],
                },
                segment.seatsReserved,
              ],
            },
          },
        };
        const reserved = await this.flights.updateOne(
          {
            _id: segment.flightId,
            status: 'Scheduled',
            departureAt: { $gt: new Date() },
            'cabins.category': segment.cabinCategory,
            $expr: enoughSeats,
          },
          { $inc: { 'cabins.$.heldSeats': segment.seatsReserved, __v: 1 } },
          { session },
        );
        if (!reserved.modifiedCount)
          throw new ConflictException(
            'Not enough seats remain in the selected cabin',
          );
      }
      const id = new Types.ObjectId();
      const [created] = await this.bookings.create(
        [
          {
            _id: id,
            // Preserve the submitted unique index without a shared migration.
            // This private hold marker is replaced with FLT- only on settlement.
            bookingReference: 'HOLD-' + id.toString(),
            userId: new Types.ObjectId(userId),
            status: 'Pending Payment',
            segments: quote.segments,
            passengers: quote.passengers,
            totalAmountMinor: quote.totalAmountMinor,
            currency: quote.currency,
            policySnapshot: quote.policySnapshot,
            holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        ],
        { session },
      );
      return created;
    });
    return {
      booking: this.view(booking),
      hold: { expiresAt: booking.holdExpiresAt, durationMinutes: 10 },
    };
  }

  async owned(userId: string, id: string) {
    await this.expireDue();
    const booking = await this.bookings.findOne({ _id: id, userId }).lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return this.view(booking);
  }

  async list(
    userId: string,
    group: 'Upcoming' | 'Past' | 'Cancelled' | undefined,
    page: number,
  ) {
    await this.expireDue();
    const now = new Date();
    const filter =
      group === 'Cancelled'
        ? { status: 'Cancelled' }
        : group === 'Past'
          ? {
              $or: [
                { status: 'Completed' },
                {
                  status: 'Confirmed',
                  $expr: {
                    $lte: [{ $arrayElemAt: ['$segments.arrivalAt', -1] }, now],
                  },
                },
              ],
            }
          : group === 'Upcoming'
            ? {
                $or: [
                  { status: 'Pending Payment', holdExpiresAt: { $gt: now } },
                  {
                    status: 'Confirmed',
                    $expr: {
                      $gt: [{ $arrayElemAt: ['$segments.arrivalAt', -1] }, now],
                    },
                  },
                ],
              }
            : {};
    const [result] = await this.bookings
      .aggregate<{ data: FlightBooking[]; count: { total: number }[] }>([
        { $match: { userId: new Types.ObjectId(userId), ...filter } },
        {
          $facet: {
            data: [
              { $sort: { createdAt: -1, _id: -1 } },
              { $skip: (page - 1) * 10 },
              { $limit: 10 },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result.count[0]?.total ?? 0;
    return {
      data: result.data.map((b) => this.view(b)),
      meta: { page, limit: 10, total, totalPages: Math.ceil(total / 10) },
    };
  }

  private completed(booking: FlightBooking): boolean {
    return (
      booking.status === 'Completed' ||
      (booking.status === 'Confirmed' &&
        booking.segments[booking.segments.length - 1].arrivalAt <= new Date())
    );
  }
  private cancellation(booking: FlightBooking) {
    const days = Math.max(
      0,
      Math.floor(
        (booking.segments[0].departureAt.getTime() - Date.now()) / 86_400_000,
      ),
    );
    const percent = refundPercent(booking.policySnapshot.cancellation, days);
    return {
      refundPercent: percent,
      refundMinor: Math.round((booking.totalAmountMinor * percent) / 100),
    };
  }

  async cancel(userId: string, id: string) {
    const booking = await this.connection.transaction(async (session) => {
      const current = await this.bookings
        .findOne({ _id: id, userId })
        .session(session)
        .lean();
      if (!current) throw new NotFoundException('Booking not found');
      if (
        current.status !== 'Confirmed' ||
        current.segments[0].departureAt <= new Date()
      )
        throw new ConflictException(
          'Only Confirmed bookings before outbound departure can be cancelled',
        );
      const refund = this.cancellation(current);
      const changed = await this.bookings
        .findOneAndUpdate(
          { _id: id, status: 'Confirmed' },
          { $set: { status: 'Cancelled', cancelledAt: new Date(), ...refund } },
          { new: true, session },
        )
        .lean();
      if (!changed || !changed.paymentId)
        throw new ConflictException('Confirmed booking has no linked payment');
      await this.settlement.release(changed, 'bookedSeats', session);
      await this.refunds.enqueueCancellation(
        {
          paymentId: changed.paymentId,
          bookingId: id,
          userId,
          amountMinor: refund.refundMinor,
          reason: 'user_cancellation',
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
          resourceId: id,
          outcome: 'success',
        },
        [
          {
            recipientId: userId,
            eventType: 'booking.cancelled',
            resourceType: 'flight-booking',
            resourceId: id,
            message:
              'Your flight booking ' +
              changed.bookingReference +
              ' is Cancelled.',
          },
        ],
      );
      return changed;
    });
    return this.view(booking);
  }

  view(booking: FlightBooking & { _id: { toString(): string } }) {
    return {
      id: booking._id.toString(),
      reference: ['Confirmed', 'Completed', 'Cancelled'].includes(booking.status) ? booking.bookingReference : null,
      status: this.completed(booking) ? 'Completed' : booking.status,
      segments: booking.segments,
      passengers: booking.passengers,
      totalAmountMinor: booking.totalAmountMinor,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
      confirmedAt: booking.confirmedAt ?? null,
      cancelledAt: booking.cancelledAt ?? null,
      policies: booking.policySnapshot,
      refundPreview:
        booking.status === 'Confirmed' &&
        booking.segments[0].departureAt > new Date()
          ? this.cancellation(booking)
          : null,
      refundMinor: booking.refundMinor ?? null,
      createdAt: booking.createdAt,
    };
  }
}

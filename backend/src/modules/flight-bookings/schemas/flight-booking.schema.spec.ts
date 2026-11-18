import mongoose from 'mongoose';
import { FlightBookingSchema } from './flight-booking.schema';

const TestBooking = mongoose.model(
  'FlightBookingSchemaTest',
  FlightBookingSchema,
);

describe('FlightBookingSchema', () => {
  const validSegment = {
    flightId: new mongoose.Types.ObjectId(),
    airlineId: new mongoose.Types.ObjectId(),
    flightNumber: 'MS985',
    airlineName: 'Test Airline',
    departureLocalDate: '2026-12-10',
    departureAirportCode: 'CAI',
    arrivalAirportCode: 'JFK',
    departureAt: new Date('2026-12-10T08:30:00.000Z'),
    arrivalAt: new Date('2026-12-10T16:30:00.000Z'),
    cabinCategory: 'Economy',
    seatsReserved: 1,
    baseFareMinor: 45000,
    segmentTotalMinor: 45000,
  };

  const validPassenger = {
    fullName: 'Test Passenger',
    dateOfBirth: new Date('1995-05-10'),
    passengerType: 'Adult',
    identityDocumentNumber: 'TEST12345',
    extraBags: 0,
    extraBaggageFeeMinor: 0,
  };

  const validBooking = () => ({
    userId: new mongoose.Types.ObjectId(),
    bookingReference: 'GIU-TEST-001',
    segments: [{ ...validSegment }],
    passengers: [{ ...validPassenger }],
    totalAmountMinor: 45000,
    currency: 'USD',
    holdExpiresAt: new Date(Date.now() + 600000),
    policySnapshot: {
      type: 'flight',
      cancellation: [],
      baggage: [
        {
          segmentId: 'outbound',
          cabin: 'Economy',
          freeBagCount: 1,
          maxWeightKg: 23,
          extraBagPriceMinor: 1000,
          maxExtraBags: 1,
        },
      ],
    },
  });

  afterAll(async () => {
    await mongoose.deleteModel('FlightBookingSchemaTest');
  });

  it('accepts a valid one-way booking', async () => {
    const booking = new TestBooking(validBooking());
    await expect(booking.validate()).resolves.toBeUndefined();
  });

  it('accepts a valid round-trip booking', async () => {
    const data = validBooking();
    data.segments.push({
      ...validSegment,
      flightId: new mongoose.Types.ObjectId(),
      flightNumber: 'MS986',
      departureAirportCode: 'JFK',
      arrivalAirportCode: 'CAI',
    });

    const booking = new TestBooking(data);
    await expect(booking.validate()).resolves.toBeUndefined();
  });

  it('rejects a booking without passengers', async () => {
    const data = validBooking();
    data.passengers = [];

    const booking = new TestBooking(data);
    await expect(booking.validate()).rejects.toThrow();
  });

  it('rejects a booking with more than two segments', async () => {
    const data = validBooking();
    data.segments.push({ ...validSegment }, { ...validSegment });

    const booking = new TestBooking(data);
    await expect(booking.validate()).rejects.toThrow();
  });

  it('rejects an invalid booking status', async () => {
    const booking = new TestBooking({
      ...validBooking(),
      status: 'Processing',
    });

    await expect(booking.validate()).rejects.toThrow();
  });

  it('rejects missing required booking fields', async () => {
    const booking = new TestBooking({
      bookingReference: 'GIU-TEST-002',
    });

    await expect(booking.validate()).rejects.toThrow();
  });
});

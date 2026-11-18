import { BadRequestException } from '@nestjs/common';
import {
  calculateFlightPassengerPricing,
} from './flight-passenger-pricing.util';

describe('FlightPassengerPricing', () => {
  const baseInput = {
    departureLocalDate: '2026-12-10',
    cabinPriceMinor: 45000,
    extraBagPriceMinor: 5000,
    maxExtraBags: 2,
  };

  const passenger = (
    dateOfBirth: string,
    extraBags = 0,
    fullName = 'Test Passenger',
  ) => ({
    fullName,
    dateOfBirth,
    identityDocumentNumber: 'TEST12345',
    extraBags,
  });

  it('classifies passengers aged 12 or older as adults', () => {
    const result = calculateFlightPassengerPricing({
      ...baseInput,
      passengers: [passenger('2014-12-10')],
    });

    expect(result.passengers[0].passengerType).toBe('Adult');
    expect(result.seatsRequired).toBe(1);
    expect(result.totalAmountMinor).toBe(45000);
  });

  it('classifies passengers aged 2 to 11 as children', () => {
    const result = calculateFlightPassengerPricing({
      ...baseInput,
      passengers: [
        passenger('1995-05-10'),
        passenger('2020-12-10'),
        passenger('2015-12-09'),
      ],
    });

    expect(result.passengers.map((p) => p.passengerType)).toEqual([
      'Adult',
      'Child',
      'Child',
    ]);
    expect(result.seatsRequired).toBe(3);
  });

  it('classifies passengers under 2 as infants', () => {
    const result = calculateFlightPassengerPricing({
      ...baseInput,
      passengers: [
        passenger('1995-05-10'),
        passenger('1994-03-15'),
        passenger('2025-12-10'),
        passenger('2026-01-01'),
      ],
    });

    expect(result.passengers.map((p) => p.passengerType)).toEqual([
      'Adult',
      'Adult',
      'Infant',
      'Infant',
    ]);
    expect(result.passengers[2].baseFareMinor).toBe(4500);
    expect(result.passengers[3].baseFareMinor).toBe(4500);
    expect(result.seatsRequired).toBe(2);
  });

  it('calculates mixed passenger fares and required seats', () => {
    const result = calculateFlightPassengerPricing({
      ...baseInput,
      passengers: [
        passenger('1995-05-10'),
        passenger('2020-05-10'),
        passenger('2026-01-10'),
      ],
    });

    expect(result.passengerCount).toBe(3);
    expect(result.seatsRequired).toBe(2);
    expect(result.totalBaseFareMinor).toBe(94500);
    expect(result.totalAmountMinor).toBe(94500);
  });

  it('calculates extra baggage fees', () => {
    const result = calculateFlightPassengerPricing({
      ...baseInput,
      passengers: [passenger('1995-05-10', 2)],
    });

    expect(result.passengers[0].extraBaggageFeeMinor).toBe(10000);
    expect(result.totalAmountMinor).toBe(55000);
  });

  it('rejects a booking without an adult', () => {
    expect(() =>
      calculateFlightPassengerPricing({
        ...baseInput,
        passengers: [passenger('2020-05-10')],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects more infants than adults', () => {
    expect(() =>
      calculateFlightPassengerPricing({
        ...baseInput,
        passengers: [
          passenger('1995-05-10'),
          passenger('2026-01-10'),
          passenger('2026-02-10'),
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects extra bags above the airline maximum', () => {
    expect(() =>
      calculateFlightPassengerPricing({
        ...baseInput,
        passengers: [passenger('1995-05-10', 3)],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a date of birth after departure', () => {
    expect(() =>
      calculateFlightPassengerPricing({
        ...baseInput,
        passengers: [passenger('2027-01-01')],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an invalid date of birth', () => {
    expect(() =>
      calculateFlightPassengerPricing({
        ...baseInput,
        passengers: [passenger('2020-02-30')],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an invalid departure date', () => {
    expect(() =>
      calculateFlightPassengerPricing({
        ...baseInput,
        departureLocalDate: '2026-02-30',
        passengers: [passenger('1995-05-10')],
      }),
    ).toThrow(BadRequestException);
  });
});



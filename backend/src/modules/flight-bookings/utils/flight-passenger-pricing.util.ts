import { BadRequestException } from '@nestjs/common';
import { PassengerType } from '../schemas/flight-booking.schema';

export interface PassengerPricingInput {
  fullName: string;
  dateOfBirth: string;
  identityDocumentNumber: string;
  extraBags: number;
}

export interface PassengerPricingResult {
  fullName: string;
  dateOfBirth: Date;
  passengerType: PassengerType;
  identityDocumentNumber: string;
  extraBags: number;
  baseFareMinor: number;
  extraBaggageFeeMinor: number;
  totalMinor: number;
  occupiesSeat: boolean;
}

export interface FlightPassengerPricingInput {
  passengers: PassengerPricingInput[];
  departureLocalDate: string;
  cabinPriceMinor: number;
  extraBagPriceMinor: number;
  maxExtraBags: number;
}

export interface FlightPassengerPricingResult {
  passengers: PassengerPricingResult[];
  passengerCount: number;
  seatsRequired: number;
  totalBaseFareMinor: number;
  totalExtraBaggageFeeMinor: number;
  totalAmountMinor: number;
}

function parseDateOnly(value: string, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} is not a valid date`);
  }

  return date;
}

function calculateAge(dateOfBirth: string, departureDate: string): number {
  const birth = parseDateOnly(dateOfBirth, 'Date of birth');
  parseDateOnly(departureDate, 'Departure date');

  if (birth.getTime() > Date.parse(`${departureDate}T00:00:00.000Z`)) {
    throw new BadRequestException(
      'Passenger date of birth cannot be after the departure date',
    );
  }

  let age = Number(departureDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));

  const birthMonth = Number(dateOfBirth.slice(5, 7));
  const departureMonth = Number(departureDate.slice(5, 7));
  const birthDay = Number(dateOfBirth.slice(8, 10));
  const departureDay = Number(departureDate.slice(8, 10));

  if (
    departureMonth < birthMonth ||
    (departureMonth === birthMonth && departureDay < birthDay)
  ) {
    age--;
  }

  return age;
}

function classifyPassenger(age: number): PassengerType {
  if (age >= 12) return 'Adult';
  if (age >= 2) return 'Child';
  return 'Infant';
}

function safeAdd(left: number, right: number): number {
  const result = left + right;

  if (!Number.isSafeInteger(result)) {
    throw new BadRequestException('Booking total exceeds the supported amount');
  }

  return result;
}

export function calculateFlightPassengerPricing(
  input: FlightPassengerPricingInput,
): FlightPassengerPricingResult {
  if (!Array.isArray(input.passengers) || input.passengers.length === 0) {
    throw new BadRequestException(
      'A booking must contain at least one passenger',
    );
  }

  if (
    !Number.isSafeInteger(input.cabinPriceMinor) ||
    input.cabinPriceMinor <= 0
  ) {
    throw new BadRequestException('Cabin price must be a positive integer');
  }

  if (
    !Number.isSafeInteger(input.extraBagPriceMinor) ||
    input.extraBagPriceMinor <= 0
  ) {
    throw new BadRequestException(
      'Extra baggage price must be a positive integer',
    );
  }

  if (!Number.isSafeInteger(input.maxExtraBags) || input.maxExtraBags < 0) {
    throw new BadRequestException(
      'Maximum extra bags must be a non-negative integer',
    );
  }

  const passengers: PassengerPricingResult[] = input.passengers.map(
    (passenger) => {
      if (
        typeof passenger.fullName !== 'string' ||
        !passenger.fullName.trim() ||
        passenger.fullName.trim().length > 150
      ) {
        throw new BadRequestException('Passenger full name is required');
      }

      if (
        typeof passenger.identityDocumentNumber !== 'string' ||
        !passenger.identityDocumentNumber.trim() ||
        passenger.identityDocumentNumber.trim().length > 100
      ) {
        throw new BadRequestException(
          'Passenger identity document number is required',
        );
      }

      if (
        !Number.isSafeInteger(passenger.extraBags) ||
        passenger.extraBags < 0 ||
        passenger.extraBags > input.maxExtraBags
      ) {
        throw new BadRequestException(
          `Each passenger may add between 0 and ${input.maxExtraBags} extra bags`,
        );
      }

      const dateOfBirth = parseDateOnly(passenger.dateOfBirth, 'Date of birth');

      const age = calculateAge(passenger.dateOfBirth, input.departureLocalDate);

      const passengerType = classifyPassenger(age);
      const occupiesSeat = passengerType !== 'Infant';

      const baseFareMinor = occupiesSeat
        ? input.cabinPriceMinor
        : Math.round(input.cabinPriceMinor / 10);

      const extraBaggageFeeMinor =
        passenger.extraBags * input.extraBagPriceMinor;

      if (!Number.isSafeInteger(extraBaggageFeeMinor)) {
        throw new BadRequestException(
          'Extra baggage fee exceeds the supported amount',
        );
      }

      return {
        fullName: passenger.fullName.trim(),
        dateOfBirth,
        passengerType,
        identityDocumentNumber: passenger.identityDocumentNumber.trim(),
        extraBags: passenger.extraBags,
        baseFareMinor,
        extraBaggageFeeMinor,
        totalMinor: safeAdd(baseFareMinor, extraBaggageFeeMinor),
        occupiesSeat,
      };
    },
  );

  const adults = passengers.filter(
    (passenger) => passenger.passengerType === 'Adult',
  ).length;

  const infants = passengers.filter(
    (passenger) => passenger.passengerType === 'Infant',
  ).length;

  if (adults < 1) {
    throw new BadRequestException('At least one adult passenger is required');
  }

  if (infants > adults) {
    throw new BadRequestException(
      'The number of infants cannot exceed the number of adults',
    );
  }

  let totalBaseFareMinor = 0;
  let totalExtraBaggageFeeMinor = 0;
  let seatsRequired = 0;

  for (const passenger of passengers) {
    totalBaseFareMinor = safeAdd(totalBaseFareMinor, passenger.baseFareMinor);

    totalExtraBaggageFeeMinor = safeAdd(
      totalExtraBaggageFeeMinor,
      passenger.extraBaggageFeeMinor,
    );

    if (passenger.occupiesSeat) {
      seatsRequired++;
    }
  }

  return {
    passengers,
    passengerCount: passengers.length,
    seatsRequired,
    totalBaseFareMinor,
    totalExtraBaggageFeeMinor,
    totalAmountMinor: safeAdd(totalBaseFareMinor, totalExtraBaggageFeeMinor),
  };
}

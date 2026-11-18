import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { FlightsService } from './flights.service';
import { CreateFlightDto } from './dto/create-flight.dto';

describe('FlightsService', () => {
  const moderatorId = new Types.ObjectId();
  const airlineId = new Types.ObjectId();
  const departureAirportId = new Types.ObjectId();
  const arrivalAirportId = new Types.ObjectId();

  const airline = {
    _id: airlineId,
    moderatorId,
    status: 'active',
  };

  const departureAirport = {
    _id: departureAirportId,
    iataCode: 'CAI',
    timeZone: 'Africa/Cairo',
  };

  const arrivalAirport = {
    _id: arrivalAirportId,
    iataCode: 'JFK',
    timeZone: 'America/New_York',
  };

  const createDto: CreateFlightDto = {
    flightNumber: 'MS985',
    departureAirportCode: 'CAI',
    arrivalAirportCode: 'JFK',
    departureLocalDateTime: '2099-01-15T10:30',
    arrivalLocalDateTime: '2099-01-15T06:30',
    cabins: [
      {
        category: 'Economy',
        totalSeats: 180,
        price: 45000,
        freeBags: 1,
        maxWeightPerBag: 23,
      },
    ],
  };

  const makeService = (
    flights: Record<string, jest.Mock>,
    airlines: Record<string, jest.Mock>,
    airports: Record<string, jest.Mock>,
  ) =>
    new FlightsService(
      flights as never,
      airlines as never,
      airports as never,
    );

  const makeAirlineModel = (result: unknown = airline) => ({
    findOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(result),
    }),
  });

  const makeAirportModel = (
    departure: typeof departureAirport | null = departureAirport,
    arrival = arrivalAirport,
  ) => ({
    findOne: jest.fn((filter: Record<string, unknown>) => ({
      exec: jest.fn().mockResolvedValue(
        filter.iataCode === 'CAI' ? departure : arrival,
      ),
    })),
  });

  it('creates a flight with UTC times and initialized cabin inventory', async () => {
    const expectedFlight = { _id: new Types.ObjectId() };

    const flights = {
      create: jest.fn().mockResolvedValue(expectedFlight),
    };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), createDto),
    ).resolves.toEqual(expectedFlight);

    expect(flights.create).toHaveBeenCalledWith(
      expect.objectContaining({
        airlineId,
        flightNumber: 'MS985',
        departureAirportId,
        arrivalAirportId,
        departureAt: new Date('2099-01-15T08:30:00.000Z'),
        arrivalAt: new Date('2099-01-15T11:30:00.000Z'),
        departureLocalDate: '2099-01-15',
        status: 'Scheduled',
        cabins: [
          {
            ...createDto.cabins[0],
            bookedSeats: 0,
            heldSeats: 0,
          },
        ],
      }),
    );
  });

  it('rejects a moderator without an assigned airline', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel(null);
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), createDto),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(flights.create).not.toHaveBeenCalled();
  });

  it('rejects a deactivated airline', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel({
      ...airline,
      status: 'deactivated',
    });
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), createDto),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(airports.findOne).not.toHaveBeenCalled();
    expect(flights.create).not.toHaveBeenCalled();
  });

  it('rejects identical departure and arrival airports', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), {
        ...createDto,
        arrivalAirportCode: 'CAI',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(airports.findOne).not.toHaveBeenCalled();
  });

  it('rejects airports outside the official airport list', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel(null, arrivalAirport);

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), createDto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(flights.create).not.toHaveBeenCalled();
  });

  it('rejects departure times in the past', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), {
        ...createDto,
        departureLocalDateTime: '2000-01-15T10:30',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(flights.create).not.toHaveBeenCalled();
  });

  it('rejects arrival times before departure in UTC', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), {
        ...createDto,
        arrivalLocalDateTime: '2099-01-15T01:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(flights.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate cabin categories', async () => {
    const flights = { create: jest.fn() };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), {
        ...createDto,
        cabins: [
          ...createDto.cabins,
          { ...createDto.cabins[0] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(flights.create).not.toHaveBeenCalled();
  });

  it('converts duplicate flight numbers into a conflict response', async () => {
    const duplicateError = Object.assign(
      new Error('Duplicate key'),
      { code: 11000 },
    );

    const flights = {
      create: jest.fn().mockRejectedValue(duplicateError),
    };
    const airlines = makeAirlineModel();
    const airports = makeAirportModel();

    const service = makeService(flights, airlines, airports);

    await expect(
      service.createForModerator(moderatorId.toString(), createDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});


import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

describe('AirlinesService', () => {
  const moderatorId = new Types.ObjectId();
  const airlineId = new Types.ObjectId();

  const moderator = {
    _id: moderatorId,
    roles: ['airline_moderator'],
    status: 'active',
  };

  const airline = {
    _id: airlineId,
    name: 'EgyptAir',
    code: 'MS',
    logoUrl: 'https://example.com/egyptair.png',
    moderatorId,
    status: 'active',
  };

  const createDto: CreateAirlineDto = {
    name: 'EgyptAir',
    code: 'MS',
    logoUrl: 'https://example.com/egyptair.png',
    moderatorId: moderatorId.toString(),
  };

  const makeService = (airlines: Record<string, jest.Mock>, users: Record<string, jest.Mock>) =>
    new AirlinesService(airlines as never, users as never);

  it('creates an airline for a valid active airline moderator', async () => {
    const airlines = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(airline),
    };
    const users = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(moderator),
      }),
    };

    const service = makeService(airlines, users);

    await expect(service.create(createDto)).resolves.toEqual(airline);

    expect(users.findOne).toHaveBeenCalledWith({
      _id: createDto.moderatorId,
      status: 'active',
      roles: 'airline_moderator',
    });
    expect(airlines.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'EgyptAir',
        code: 'MS',
        moderatorId,
        status: 'active',
      }),
    );
  });

  it('rejects creation when the moderator account does not exist or is inactive', async () => {
    const airlines = {
      exists: jest.fn(),
      create: jest.fn(),
    };
    const users = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    };

    const service = makeService(airlines, users);

    await expect(service.create(createDto)).rejects.toBeInstanceOf(NotFoundException);
    expect(airlines.create).not.toHaveBeenCalled();
  });

  it('rejects accounts that do not have the airline_moderator role', async () => {
    const users = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    };
    const airlines = {
      exists: jest.fn(),
      create: jest.fn(),
    };

    const service = makeService(airlines, users);

    await expect(service.create(createDto)).rejects.toBeInstanceOf(NotFoundException);

    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ roles: 'airline_moderator' }),
    );
  });

  it('rejects assigning a moderator who already owns an airline', async () => {
    const users = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(moderator),
      }),
    };
    const airlines = {
      exists: jest.fn().mockResolvedValue(true),
      create: jest.fn(),
    };

    const service = makeService(airlines, users);

    await expect(service.create(createDto)).rejects.toBeInstanceOf(ConflictException);
    expect(airlines.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate airline codes reported by MongoDB', async () => {
    const users = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(moderator),
      }),
    };
    const airlines = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue({ code: 11000 }),
    };

    const service = makeService(airlines, users);

    await expect(service.create(createDto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a moderator to update their own airline profile', async () => {
    const updatedAirline = { ...airline, name: 'EgyptAir Updated' };
    const users = {};
    const airlines = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedAirline),
      }),
    };

    const service = makeService(airlines, users);
    const dto: UpdateAirlineDto = { name: 'EgyptAir Updated' };

    await expect(
      service.updateOwnAirline(
        moderatorId.toString(),
        airlineId.toString(),
        dto,
      ),
    ).resolves.toEqual(updatedAirline);

    expect(airlines.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: airlineId.toString(),
        moderatorId: moderatorId.toString(),
      },
      { $set: { name: 'EgyptAir Updated' } },
      { new: true, runValidators: true },
    );
  });

  it('prevents a moderator from updating another airline', async () => {
    const otherModeratorId = new Types.ObjectId();
    const users = {};
    const airlines = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      exists: jest.fn().mockResolvedValue(true),
    };

    const service = makeService(airlines, users);

    await expect(
      service.updateOwnAirline(
        otherModeratorId.toString(),
        airlineId.toString(),
        { name: 'Unauthorized Update' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(airlines.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid airline IDs without querying MongoDB', async () => {
    const airlines = {
      findById: jest.fn(),
    };
    const service = makeService(airlines, {});

    await expect(
      service.updateOwnAirline(
        moderatorId.toString(),
        'invalid-id',
        { name: 'Updated Name' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(airlines.findById).not.toHaveBeenCalled();
  });

  it('allows a moderator to update their own baggage policy', async () => {
    const policy = {
      extraBagPrice: 50,
      maxExtraBags: 2,
    };

    const updatedAirline = { ...airline, baggagePolicy: policy };
    const airlines = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedAirline),
      }),
    };

    const service = makeService(airlines, {});

    await expect(
      service.updateBaggagePolicy(
        moderatorId.toString(),
        airlineId.toString(),
        policy,
      ),
    ).resolves.toEqual(updatedAirline);

    expect(airlines.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: airlineId.toString(),
        moderatorId: moderatorId.toString(),
      },
      { $set: { baggagePolicy: policy } },
      { new: true, runValidators: true },
    );
  });

  it('prevents another moderator from updating the baggage policy', async () => {
    const otherModeratorId = new Types.ObjectId();
    const airlines = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      exists: jest.fn().mockResolvedValue(true),
    };

    const service = makeService(airlines, {});

    await expect(
      service.updateBaggagePolicy(
        otherModeratorId.toString(),
        airlineId.toString(),
        {
          extraBagPrice: 50,
          maxExtraBags: 2,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a moderator to update cancellation policy and sorts its tiers', async () => {
    const policy = {
      tiers: [
        { daysBeforeDeparture: 7, refundPercentage: 50 },
        { daysBeforeDeparture: 30, refundPercentage: 80 },
        { daysBeforeDeparture: 0, refundPercentage: 0 },
      ],
    };

    const sortedTiers = [
      { daysBeforeDeparture: 30, refundPercentage: 80 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
      { daysBeforeDeparture: 0, refundPercentage: 0 },
    ];

    const updatedAirline = {
      ...airline,
      cancellationPolicy: sortedTiers,
    };

    const airlines = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedAirline),
      }),
    };

    const service = makeService(airlines, {});

    await expect(
      service.updateCancellationPolicy(
        moderatorId.toString(),
        airlineId.toString(),
        policy,
      ),
    ).resolves.toEqual(updatedAirline);

    expect(airlines.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: airlineId.toString(),
        moderatorId: moderatorId.toString(),
      },
      { $set: { cancellationPolicy: sortedTiers } },
      { new: true, runValidators: true },
    );
  });

  it('rejects duplicate cancellation policy thresholds', async () => {
    const airlines = {
      findOneAndUpdate: jest.fn(),
    };

    const service = makeService(airlines, {});

    await expect(
      service.updateCancellationPolicy(
        moderatorId.toString(),
        airlineId.toString(),
        {
          tiers: [
            { daysBeforeDeparture: 30, refundPercentage: 80 },
            { daysBeforeDeparture: 30, refundPercentage: 50 },
          ],
        },
      ),
    ).rejects.toThrow('Cancellation policy thresholds must be unique');

    expect(airlines.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid airline IDs when updating baggage policy', async () => {
    const airlines = {
      findOneAndUpdate: jest.fn(),
    };

    const service = makeService(airlines, {});

    await expect(
      service.updateBaggagePolicy(
        moderatorId.toString(),
        'invalid-id',
        {
          extraBagPrice: 50,
          maxExtraBags: 2,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(airlines.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid airline IDs when updating cancellation policy', async () => {
    const airlines = {
      findOneAndUpdate: jest.fn(),
    };

    const service = makeService(airlines, {});

    await expect(
      service.updateCancellationPolicy(
        moderatorId.toString(),
        'invalid-id',
        {
          tiers: [
            { daysBeforeDeparture: 30, refundPercentage: 80 },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(airlines.findOneAndUpdate).not.toHaveBeenCalled();
  });
});


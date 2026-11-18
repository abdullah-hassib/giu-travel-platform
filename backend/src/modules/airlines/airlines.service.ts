import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline } from './schemas/airline.schema';
import { User } from '../users/schemas/user.schema';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name)
    private readonly airlines: Model<Airline>,
    @InjectModel(User.name)
    private readonly users: Model<User>,
  ) {}

  async create(dto: CreateAirlineDto): Promise<Airline> {
    const moderator = await this.users.findOne({
      _id: dto.moderatorId,
      status: 'active',
      roles: 'airline_moderator',
    }).exec();

    if (!moderator) {
      throw new NotFoundException(
        'Active airline moderator account not found',
      );
    }

    const alreadyAssigned = await this.airlines.exists({
      moderatorId: moderator._id,
    });

    if (alreadyAssigned) {
      throw new ConflictException(
        'This moderator is already assigned to an airline',
      );
    }

    try {
      return await this.airlines.create({
        name: dto.name,
        code: dto.code,
        logoUrl: dto.logoUrl,
        moderatorId: moderator._id,
        status: 'active',
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'Airline code or moderator assignment already exists',
        );
      }
      throw error;
    }
  }

  async updateOwnAirline(
    moderatorId: string,
    airlineId: string,
    dto: UpdateAirlineDto,
  ): Promise<Airline> {
    this.validateAirlineId(airlineId);

    const updates = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.code !== undefined ? { code: dto.code } : {}),
      ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
    };

    try {
      const updated = await this.airlines.findOneAndUpdate(
        { _id: airlineId, moderatorId },
        { $set: updates },
        { new: true, runValidators: true },
      ).exec();

      if (!updated) {
        await this.handleMissingOrUnauthorizedAirline(airlineId);
      }

      return updated!;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException('Airline code already exists');
      }
      throw error;
    }
  }

  async updateBaggagePolicy(
    moderatorId: string,
    airlineId: string,
    dto: BaggagePolicyDto,
  ): Promise<Airline> {
    this.validateAirlineId(airlineId);

    const updated = await this.airlines.findOneAndUpdate(
      { _id: airlineId, moderatorId },
      { $set: { baggagePolicy: dto } },
      { new: true, runValidators: true },
    ).exec();

    if (!updated) {
      await this.handleMissingOrUnauthorizedAirline(airlineId);
    }

    return updated!;
  }

  async updateCancellationPolicy(
    moderatorId: string,
    airlineId: string,
    dto: CancellationPolicyDto,
  ): Promise<Airline> {
    this.validateAirlineId(airlineId);

    const thresholds = dto.tiers.map(
      (tier) => tier.daysBeforeDeparture,
    );

    if (new Set(thresholds).size !== thresholds.length) {
      throw new BadRequestException(
        'Cancellation policy thresholds must be unique',
      );
    }

    const sortedTiers = [...dto.tiers].sort(
      (a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture,
    );

    const updated = await this.airlines.findOneAndUpdate(
      { _id: airlineId, moderatorId },
      { $set: { cancellationPolicy: sortedTiers } },
      { new: true, runValidators: true },
    ).exec();

    if (!updated) {
      await this.handleMissingOrUnauthorizedAirline(airlineId);
    }

    return updated!;
  }

  async findById(airlineId: string): Promise<Airline> {
    this.validateAirlineId(airlineId);

    const airline = await this.airlines.findById(airlineId).exec();

    if (!airline) {
      throw new NotFoundException('Airline not found');
    }

    return airline;
  }

  private validateAirlineId(airlineId: string): void {
    if (!Types.ObjectId.isValid(airlineId)) {
      throw new NotFoundException('Airline not found');
    }
  }

  private async handleMissingOrUnauthorizedAirline(
    airlineId: string,
  ): Promise<never> {
    const airlineExists = await this.airlines.exists({
      _id: airlineId,
    });

    if (!airlineExists) {
      throw new NotFoundException('Airline not found');
    }

    throw new ForbiddenException(
      'You can only manage your assigned airline',
    );
  }
}

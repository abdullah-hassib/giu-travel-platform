import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { ModeratorAssignment } from '../administration/schemas/moderator-assignment.schema';
import { ModeratorAssignmentsService } from '../administration/moderator-assignments.module';
import { DomainEventPublisherService } from '../domain-events/domain-event-publisher.service';
import { publishEffects } from '../domain-events/publish-effects';
import { Airline } from './schemas/airline.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';
import { isStoredLogoUrl } from './dto/airline-logo-url.validator';
import { MediaService, UploadedImage } from '../media-uploads/media.service';
import { PublicUser } from '../users/users.service';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(ModeratorAssignment.name)
    private readonly assignments: Model<ModeratorAssignment>,
    @InjectConnection() private readonly connection: Connection,
    private readonly ownership: ModeratorAssignmentsService,
    private readonly events: DomainEventPublisherService,
    private readonly media: MediaService,
  ) {}

  async create(
    dto: CreateAirlineDto,
    actorId: string,
    file?: UploadedImage,
  ): Promise<Airline> {
    if (file && dto.logoUrl)
      throw new BadRequestException(
        'Use an uploaded file or logoUrl, not both',
      );
    if (!file && (!dto.logoUrl || isStoredLogoUrl(dto.logoUrl)))
      throw new BadRequestException(
        'Upload one logo file or provide a legacy absolute logoUrl',
      );
    const image = file ? await this.media.saveImage(file) : undefined;
    try {
      return await this.connection.transaction(async (session) => {
        const [airline] = await this.airlines.create(
          [
            {
              ...dto,
              logoUrl: image?.url ?? dto.logoUrl,
              ...(image && { logoImage: image }),
              status: 'active',
            },
          ],
          { session },
        );
        await publishEffects(this.events, session, 'airline.created', actorId, {
          action: 'airline.created',
          resourceType: 'airline',
          resourceId: airline._id.toString(),
          outcome: 'success',
        });
        return airline;
      });
    } catch (error) {
      if (image) await this.media.removeImage(image.id);
      this.rethrowDuplicate(error);
    }
  }

  async replaceLogo(
    user: PublicUser,
    airlineId: string,
    file: UploadedImage | undefined,
  ): Promise<Airline> {
    if (!user.roles.includes('admin'))
      await this.assertAssigned(user.id, airlineId);
    await this.findById(airlineId);
    const image = await this.media.saveImage(file);
    try {
      const result = await this.connection.transaction(async (session) => {
        const before = await this.airlines
          .findByIdAndUpdate(
            airlineId,
            {
              $set: { logoUrl: image.url, logoImage: image },
              $inc: { inventoryVersion: 1 },
            },
            { session, runValidators: true },
          )
          .select('+logoImage');
        if (!before) throw new NotFoundException('Airline not found');
        await publishEffects(this.events, session, 'airline.updated', user.id, {
          action: 'airline.updated',
          resourceType: 'airline',
          resourceId: airlineId,
          outcome: 'success',
          metadata: { field: 'logo' },
        });
        const airline = await this.airlines
          .findById(airlineId)
          .session(session)
          .orFail();
        return { airline, obsoleteImageId: before.logoImage?.id };
      });
      if (result.obsoleteImageId)
        await this.media.removeImage(result.obsoleteImageId);
      return result.airline;
    } catch (error) {
      await this.media.removeImage(image.id);
      throw error;
    }
  }

  async assertAssigned(userId: string, airlineId?: string): Promise<string> {
    const assignment = await this.ownership.getForModerator(userId);
    if (
      !assignment ||
      assignment.providerType !== 'airline' ||
      (airlineId && assignment.providerId !== airlineId)
    )
      throw new ForbiddenException('You can only manage your assigned airline');
    return assignment.providerId;
  }

  async updateOwnAirline(
    userId: string,
    airlineId: string,
    dto: UpdateAirlineDto,
  ): Promise<Airline> {
    await this.assertAssigned(userId, airlineId);
    try {
      return await this.change(airlineId, dto, userId, 'airline.updated');
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async updateBaggagePolicy(
    userId: string,
    airlineId: string,
    dto: BaggagePolicyDto,
  ): Promise<Airline> {
    await this.assertAssigned(userId, airlineId);
    return this.change(
      airlineId,
      { baggagePolicy: dto },
      userId,
      'airline.policies_updated',
    );
  }

  async updateCancellationPolicy(
    userId: string,
    airlineId: string,
    dto: CancellationPolicyDto,
  ): Promise<Airline> {
    await this.assertAssigned(userId, airlineId);
    if (
      new Set(dto.tiers.map((tier) => tier.daysBeforeDeparture)).size !==
      dto.tiers.length
    )
      throw new BadRequestException(
        'Cancellation policy thresholds must be unique',
      );
    return this.change(
      airlineId,
      {
        cancellationPolicy: [...dto.tiers].sort(
          (a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture,
        ),
      },
      userId,
      'airline.policies_updated',
    );
  }

  private async change(
    airlineId: string,
    update: object,
    actorId: string,
    action: 'airline.updated' | 'airline.policies_updated',
  ): Promise<Airline> {
    const result = await this.connection.transaction(async (session) => {
      const previous = await this.airlines
        .findById(airlineId)
        .select('+logoImage')
        .session(session);
      if (!previous) throw new NotFoundException('Airline not found');
      const logoUrl =
        'logoUrl' in update && typeof update.logoUrl === 'string'
          ? update.logoUrl
          : undefined;
      if (logoUrl && isStoredLogoUrl(logoUrl) && logoUrl !== previous.logoUrl)
        throw new BadRequestException(
          'Upload a new logo using the logo endpoint',
        );
      const clearImage = logoUrl !== undefined && logoUrl !== previous.logoUrl;
      const airline = await this.airlines
        .findByIdAndUpdate(
          airlineId,
          {
            $set: update,
            $inc: { inventoryVersion: 1 },
            ...(clearImage && { $unset: { logoImage: 1 } }),
          },
          { new: true, runValidators: true, session },
        )
        .exec();
      if (!airline) throw new NotFoundException('Airline not found');
      await publishEffects(this.events, session, action, actorId, {
        action,
        resourceType: 'airline',
        resourceId: airlineId,
        outcome: 'success',
      });
      return {
        airline,
        obsoleteImageId: clearImage ? previous.logoImage?.id : undefined,
      };
    });
    if (result.obsoleteImageId)
      await this.media.removeImage(result.obsoleteImageId);
    return result.airline;
  }

  async findById(id: string): Promise<Airline> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Airline not found');
    const airline = await this.airlines.findById(id).exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return airline;
  }

  async lockExisting(id: string, session: ClientSession) {
    const airline = await this.airlines
      .findByIdAndUpdate(
        id,
        { $inc: { inventoryVersion: 1 } },
        { new: true, session },
      )
      .exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return { id: airline._id.toString(), kind: 'airline' as const };
  }

  async setActive(actorId: string, id: string, active: boolean): Promise<void> {
    await this.connection.transaction(async (session) => {
      const changed = await this.airlines
        .findOneAndUpdate(
          { _id: id, status: active ? 'deactivated' : 'active' },
          {
            $set: { status: active ? 'active' : 'deactivated' },
            $inc: { inventoryVersion: 1 },
          },
          { session },
        )
        .exec();
      if (!changed) {
        if (!(await this.airlines.exists({ _id: id }).session(session)))
          throw new NotFoundException('Airline not found');
        return;
      }
      const assigned = await this.assignments
        .find({ providerType: 'airline', providerId: id })
        .session(session)
        .lean();
      const recipients = new Set(assigned.map((row) => row.userId.toString()));
      if (!active) {
        const reservations = await this.bookings
          .find({
            'segments.airlineId': id,
            status: 'Confirmed',
            'segments.departureAt': { $gt: new Date() },
          })
          .select('userId')
          .session(session)
          .lean();
        for (const booking of reservations)
          recipients.add(booking.userId.toString());
      }
      await this.flights.updateMany(
        { airlineId: id },
        { $inc: { __v: 1 } },
        { session },
      );
      const action = active ? 'provider.reactivated' : 'provider.deactivated';
      await publishEffects(
        this.events,
        session,
        action,
        actorId,
        {
          action,
          resourceType: 'airline',
          resourceId: id,
          outcome: 'success',
        },
        [...recipients].sort().map((recipientId) => ({
          recipientId,
          eventType: action,
          resourceType: 'airline',
          resourceId: id,
          message: active
            ? 'Your airline has been reactivated.'
            : 'This airline has been deactivated. Existing Confirmed bookings remain valid.',
        })),
      );
    });
  }

  private rethrowDuplicate(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    )
      throw new ConflictException('Airline code already exists');
    throw error;
  }
}

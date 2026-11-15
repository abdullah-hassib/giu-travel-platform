import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Error as MongooseError,
  FilterQuery,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { itineraryDate } from './calendar';
import {
  addCurrencyTotal,
  nativeBudgetSummary,
} from '../budgeting/native-budget-summary';
import {
  CreateBudgetDto,
  CreateTransportDto,
  UpdateBudgetDto,
  UpdateTransportDto,
} from '../budgeting/dto/budget.dto';
import { NativeBudgetSummaryDto } from '../budgeting/dto/budget-summary.dto';
import { CITIES, COUNTRIES } from './reference-data';
import {
  CreateActivityDto,
  CreateDayDto,
  CreateItineraryDto,
  ItinerarySearchDto,
  UpdateActivityDto,
  UpdateDayDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto';
import {
  CityGroupDto,
  ItineraryAuthorDto,
  ItineraryListViewDto,
  ItineraryViewDto,
} from './dto/itinerary-view.dto';
import {
  Itinerary,
  ItineraryActivity,
  ItineraryDay,
  ItineraryDocument,
  BudgetEntry,
  TransportEntry,
} from './schemas/itinerary.schema';

type PublicItinerary = Itinerary & { author: { fullName: string }[] };

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  private validate(itinerary: Itinerary): void {
    if (itinerary.days.length > 60)
      throw new BadRequestException('An itinerary has at most sixty days');
    if (itinerary.days.length)
      itineraryDate(itinerary.startDate, itinerary.days.length - 1);
    for (const day of itinerary.days) {
      const city = CITIES.find((candidate) => candidate.id === day.cityId);
      if (!city || !itinerary.countryCodes.includes(city.countryCode)) {
        throw new BadRequestException(
          'Each day city must belong to a selected itinerary country',
        );
      }
    }
    nativeBudgetSummary(itinerary);
  }

  private async save(itinerary: ItineraryDocument): Promise<ItineraryViewDto> {
    this.validate(itinerary);
    try {
      await itinerary.save();
    } catch (error) {
      if (
        error instanceof MongooseError.VersionError ||
        error instanceof MongooseError.DocumentNotFoundError
      ) {
        throw new ConflictException(
          'Itinerary changed concurrently; reload and retry',
        );
      }
      throw error;
    }
    return this.view(itinerary);
  }

  private async owned(ownerId: string, id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraries
      .findOne({ _id: id, ownerId })
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    return itinerary;
  }

  private day(itinerary: Itinerary, id: string): ItineraryDay {
    const day = itinerary.days.find((candidate) => candidate._id.equals(id));
    if (!day) throw new NotFoundException('Day not found');
    return day;
  }

  async create(
    ownerId: string,
    dto: CreateItineraryDto,
  ): Promise<ItineraryViewDto> {
    return this.save(
      new this.itineraries({
        ownerId,
        title: dto.title,
        countryCodes: dto.countryCodes,
        startDate: dto.startDate,
        visibility: 'private',
        days: [],
      }),
    );
  }

  async get(ownerId: string, id: string): Promise<ItineraryViewDto> {
    return this.view(await this.owned(ownerId, id));
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    if (dto.title !== undefined) itinerary.title = dto.title;
    if (dto.countryCodes !== undefined)
      itinerary.countryCodes = dto.countryCodes;
    if (dto.startDate !== undefined) itinerary.startDate = dto.startDate;
    if (dto.visibility !== undefined) itinerary.visibility = dto.visibility;
    return this.save(itinerary);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const result = await this.itineraries
      .deleteOne({ _id: id, ownerId })
      .exec();
    if (result.deletedCount !== 1)
      throw new NotFoundException('Itinerary not found');
  }

  async addDay(
    ownerId: string,
    id: string,
    dto: CreateDayDto,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    itinerary.days.push({
      _id: new Types.ObjectId(),
      cityId: dto.cityId,
      notes: dto.notes ?? '',
      activities: [],
      budgets: [],
      transportCosts: [],
    });
    return this.save(itinerary);
  }

  async updateDay(
    ownerId: string,
    id: string,
    dayId: string,
    dto: UpdateDayDto,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    const day = this.day(itinerary, dayId);
    if (dto.cityId !== undefined) day.cityId = dto.cityId;
    if (dto.notes !== undefined) day.notes = dto.notes ?? '';
    return this.save(itinerary);
  }

  async deleteDay(
    ownerId: string,
    id: string,
    dayId: string,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    this.day(itinerary, dayId);
    itinerary.days = itinerary.days.filter((day) => !day._id.equals(dayId));
    return this.save(itinerary);
  }

  async reorder(
    ownerId: string,
    id: string,
    dayIds: string[],
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    const normalizedIds = dayIds.map((dayId) => dayId.toLowerCase());
    if (
      normalizedIds.length !== itinerary.days.length ||
      new Set(normalizedIds).size !== normalizedIds.length
    ) {
      throw new BadRequestException('Supply every existing day exactly once');
    }
    itinerary.days = normalizedIds.map((dayId) => this.day(itinerary, dayId));
    return this.save(itinerary);
  }

  async addActivity(
    ownerId: string,
    id: string,
    dayId: string,
    dto: CreateActivityDto,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    this.day(itinerary, dayId).activities.push({
      _id: new Types.ObjectId(),
      name: dto.name,
      description: dto.description ?? '',
      time: dto.time ?? undefined,
      cost: dto.cost ?? undefined,
    });
    return this.save(itinerary);
  }

  private async activity(
    ownerId: string,
    activityId: string,
  ): Promise<{
    itinerary: ItineraryDocument;
    day: ItineraryDay;
    activity: ItineraryActivity;
  }> {
    const itinerary = await this.itineraries
      .findOne({ ownerId, 'days.activities._id': activityId })
      .exec();
    if (!itinerary) throw new NotFoundException('Activity not found');
    for (const day of itinerary.days) {
      const activity = day.activities.find((candidate) =>
        candidate._id.equals(activityId),
      );
      if (activity) return { itinerary, day, activity };
    }
    throw new NotFoundException('Activity not found');
  }

  async updateActivity(
    ownerId: string,
    id: string,
    dto: UpdateActivityDto,
  ): Promise<ItineraryViewDto> {
    const { itinerary, activity } = await this.activity(ownerId, id);
    if (dto.name !== undefined) activity.name = dto.name;
    if (dto.description !== undefined)
      activity.description = dto.description ?? '';
    if (dto.time !== undefined) activity.time = dto.time ?? undefined;
    if (dto.cost !== undefined) activity.cost = dto.cost ?? undefined;
    return this.save(itinerary);
  }

  async deleteActivity(ownerId: string, id: string): Promise<ItineraryViewDto> {
    const { itinerary, day } = await this.activity(ownerId, id);
    day.activities = day.activities.filter(
      (activity) => !activity._id.equals(id),
    );
    return this.save(itinerary);
  }

  async addBudget(
    ownerId: string,
    id: string,
    dayId: string,
    dto: CreateBudgetDto,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    this.day(itinerary, dayId).budgets.push({
      _id: new Types.ObjectId(),
      category: dto.category,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
    });
    return this.save(itinerary);
  }

  private async budget(
    ownerId: string,
    id: string,
  ): Promise<{
    itinerary: ItineraryDocument;
    day: ItineraryDay;
    entry: BudgetEntry;
  }> {
    const itinerary = await this.itineraries
      .findOne({ ownerId, 'days.budgets._id': id })
      .exec();
    if (itinerary) {
      for (const day of itinerary.days) {
        const entry = day.budgets.find((candidate) => candidate._id.equals(id));
        if (entry) return { itinerary, day, entry };
      }
    }
    throw new NotFoundException('Budget entry not found');
  }

  async updateBudget(
    ownerId: string,
    id: string,
    dto: UpdateBudgetDto,
  ): Promise<ItineraryViewDto> {
    const { itinerary, entry } = await this.budget(ownerId, id);
    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.amountMinor !== undefined) entry.amountMinor = dto.amountMinor;
    if (dto.currency !== undefined) entry.currency = dto.currency;
    return this.save(itinerary);
  }

  async deleteBudget(ownerId: string, id: string): Promise<ItineraryViewDto> {
    const { itinerary, day } = await this.budget(ownerId, id);
    day.budgets = day.budgets.filter((entry) => !entry._id.equals(id));
    return this.save(itinerary);
  }

  async addTransport(
    ownerId: string,
    id: string,
    dto: CreateTransportDto,
  ): Promise<ItineraryViewDto> {
    const itinerary = await this.owned(ownerId, id);
    this.day(itinerary, dto.dayId).transportCosts.push({
      _id: new Types.ObjectId(),
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
    });
    return this.save(itinerary);
  }

  private async transport(
    ownerId: string,
    id: string,
  ): Promise<{
    itinerary: ItineraryDocument;
    day: ItineraryDay;
    entry: TransportEntry;
  }> {
    const itinerary = await this.itineraries
      .findOne({ ownerId, 'days.transportCosts._id': id })
      .exec();
    if (itinerary) {
      for (const day of itinerary.days) {
        const entry = day.transportCosts.find((candidate) =>
          candidate._id.equals(id),
        );
        if (entry) return { itinerary, day, entry };
      }
    }
    throw new NotFoundException('Transport entry not found');
  }

  async updateTransport(
    ownerId: string,
    id: string,
    dto: UpdateTransportDto,
  ): Promise<ItineraryViewDto> {
    const { itinerary, day, entry } = await this.transport(ownerId, id);
    if (dto.mode !== undefined) entry.mode = dto.mode;
    if (dto.fromCityId !== undefined) entry.fromCityId = dto.fromCityId;
    if (dto.toCityId !== undefined) entry.toCityId = dto.toCityId;
    if (dto.amountMinor !== undefined) entry.amountMinor = dto.amountMinor;
    if (dto.currency !== undefined) entry.currency = dto.currency;
    if (dto.dayId !== undefined && !day._id.equals(dto.dayId)) {
      const destination = this.day(itinerary, dto.dayId);
      day.transportCosts = day.transportCosts.filter(
        (candidate) => !candidate._id.equals(id),
      );
      destination.transportCosts.push({
        _id: entry._id,
        mode: entry.mode,
        fromCityId: entry.fromCityId,
        toCityId: entry.toCityId,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
      });
    }
    return this.save(itinerary);
  }

  async deleteTransport(
    ownerId: string,
    id: string,
  ): Promise<ItineraryViewDto> {
    const { itinerary, day } = await this.transport(ownerId, id);
    day.transportCosts = day.transportCosts.filter(
      (entry) => !entry._id.equals(id),
    );
    return this.save(itinerary);
  }

  async budgetSummary(
    ownerId: string,
    id: string,
  ): Promise<NativeBudgetSummaryDto> {
    return nativeBudgetSummary(await this.owned(ownerId, id));
  }

  private publicPipeline(filter: FilterQuery<Itinerary>): PipelineStage[] {
    return [
      { $match: { ...filter, visibility: 'public' } },
      {
        $lookup: {
          from: this.users.collection.name,
          let: { authorId: '$ownerId' },
          as: 'author',
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$authorId'] },
                status: { $in: ['active', 'suspended'] },
              },
            },
            { $project: { fullName: 1 } },
          ],
        },
      },
      { $match: { 'author.0': { $exists: true } } },
    ];
  }

  private async publicSource(id: string): Promise<PublicItinerary> {
    const [itinerary] = await this.itineraries
      .aggregate<PublicItinerary>(
        this.publicPipeline({ _id: new Types.ObjectId(id) }),
      )
      .exec();
    if (!itinerary) throw new NotFoundException('Public itinerary not found');
    return itinerary;
  }

  async publicGet(id: string): Promise<ItineraryViewDto> {
    const itinerary = await this.publicSource(id);
    return this.view(itinerary, {
      id: itinerary.ownerId.toString(),
      name: itinerary.author[0].fullName,
    });
  }

  async clone(ownerId: string, id: string): Promise<ItineraryViewDto> {
    const source = await this.publicSource(id);
    const copy = new this.itineraries({
      ownerId,
      title: source.title,
      countryCodes: [...source.countryCodes],
      startDate: source.startDate,
      visibility: 'private',
      clonedFrom: {
        itineraryId: source._id,
        authorId: source.ownerId,
        authorName: source.author[0].fullName,
      },
      days: source.days.map((day) => ({
        _id: new Types.ObjectId(),
        cityId: day.cityId,
        notes: day.notes,
        budgets: (day.budgets ?? []).map((entry) => ({
          _id: new Types.ObjectId(),
          category: entry.category,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        })),
        transportCosts: (day.transportCosts ?? []).map((entry) => ({
          _id: new Types.ObjectId(),
          mode: entry.mode,
          fromCityId: entry.fromCityId,
          toCityId: entry.toCityId,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        })),
        activities: day.activities.map((activity) => ({
          _id: new Types.ObjectId(),
          name: activity.name,
          description: activity.description,
          time: activity.time,
          cost: activity.cost
            ? {
                amountMinor: activity.cost.amountMinor,
                currency: activity.cost.currency,
              }
            : undefined,
        })),
      })),
    });
    return this.save(copy);
  }

  private async page(
    pipeline: PipelineStage[],
    page: number,
  ): Promise<ItineraryListViewDto> {
    const [result] = await this.itineraries
      .aggregate<{ data: PublicItinerary[]; count: { total: number }[] }>([
        ...pipeline,
        { $sort: { updatedAt: -1, _id: -1 } },
        {
          $facet: {
            data: [{ $skip: (page - 1) * 10 }, { $limit: 10 }],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result.count[0]?.total ?? 0;
    return {
      data: result.data.map((itinerary) =>
        this.view(
          itinerary,
          itinerary.author?.[0]
            ? {
                id: itinerary.ownerId.toString(),
                name: itinerary.author[0].fullName,
              }
            : undefined,
        ),
      ),
      meta: { page, limit: 10, total, totalPages: Math.ceil(total / 10) },
    };
  }

  async list(ownerId: string, page: number): Promise<ItineraryListViewDto> {
    return this.page(
      [{ $match: { ownerId: new Types.ObjectId(ownerId) } }],
      page,
    );
  }

  async publicSearch(query: ItinerarySearchDto): Promise<ItineraryListViewDto> {
    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    )
      throw new BadRequestException('Minimum days exceeds maximum days');
    const filter: FilterQuery<Itinerary> = {};
    if (query.countryCode) filter.countryCodes = query.countryCode;
    if (query.cityId) filter['days.cityId'] = query.cityId;
    if (query.minDays !== undefined || query.maxDays !== undefined) {
      filter.$expr = {
        $and: [
          { $gte: [{ $size: '$days' }, query.minDays ?? 0] },
          { $lte: [{ $size: '$days' }, query.maxDays ?? 60] },
        ],
      };
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      filter.$or = [
        {
          title: {
            $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            $options: 'i',
          },
        },
        {
          countryCodes: {
            $in: COUNTRIES.filter((country) =>
              country.name.toLowerCase().includes(term),
            ).map((country) => country.code),
          },
        },
        {
          'days.cityId': {
            $in: CITIES.filter((city) =>
              city.name.toLowerCase().includes(term),
            ).map((city) => city.id),
          },
        },
      ];
    }
    return this.page(this.publicPipeline(filter), query.page);
  }

  private view(
    itinerary: Itinerary,
    author?: ItineraryAuthorDto,
  ): ItineraryViewDto {
    const budgetSummary = nativeBudgetSummary(itinerary);
    const days = itinerary.days.map((day, index) => ({
      id: day._id.toString(),
      dayNumber: index + 1,
      date: itineraryDate(itinerary.startDate, index),
      cityId: day.cityId,
      cityName: CITIES.find((city) => city.id === day.cityId)!.name,
      notes: day.notes,
      budgets: (day.budgets ?? []).map((entry) => ({
        id: entry._id.toString(),
        category: entry.category,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
      })),
      transportCosts: (day.transportCosts ?? []).map((entry) => ({
        id: entry._id.toString(),
        dayId: day._id.toString(),
        mode: entry.mode,
        fromCityId: entry.fromCityId,
        toCityId: entry.toCityId,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
      })),
      activities: day.activities.map((activity) => ({
        id: activity._id.toString(),
        name: activity.name,
        description: activity.description,
        time: activity.time,
        cost: activity.cost
          ? {
              amountMinor: activity.cost.amountMinor,
              currency: activity.cost.currency,
            }
          : undefined,
      })),
    }));
    const cityGroups: CityGroupDto[] = [];
    for (const day of days) {
      let group = cityGroups[cityGroups.length - 1];
      if (!group || group.cityId !== day.cityId) {
        group = {
          cityId: day.cityId,
          cityName: day.cityName,
          firstDayNumber: day.dayNumber,
          dayCount: 0,
          startDate: day.date,
          endDate: day.date,
          activityTotals: {},
          budgetTotals: {},
        };
        cityGroups.push(group);
      }
      group.dayCount += 1;
      group.endDate = day.date;
      for (const [currency, amount] of Object.entries(
        budgetSummary.byDay[day.dayNumber - 1].totalByCurrency,
      )) {
        addCurrencyTotal(group.budgetTotals, currency, amount);
      }
      for (const activity of day.activities) {
        if (activity.cost)
          group.activityTotals[activity.cost.currency] =
            (group.activityTotals[activity.cost.currency] ?? 0) +
            activity.cost.amountMinor;
      }
    }
    return {
      id: itinerary._id.toString(),
      ownerId: itinerary.ownerId.toString(),
      title: itinerary.title,
      countryCodes: [...itinerary.countryCodes],
      startDate: itinerary.startDate,
      visibility: itinerary.visibility,
      revision: itinerary.__v ?? 0,
      createdAt: itinerary.createdAt,
      updatedAt: itinerary.updatedAt,
      days,
      cityGroups,
      budgetSummary,
      author,
      clonedFrom: itinerary.clonedFrom
        ? {
            itineraryId: itinerary.clonedFrom.itineraryId.toString(),
            authorId: itinerary.clonedFrom.authorId.toString(),
            authorName: itinerary.clonedFrom.authorName,
          }
        : undefined,
    };
  }
}

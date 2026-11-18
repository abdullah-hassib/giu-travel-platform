import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  REFERENCE_SOURCE_ID,
  OFFICIAL_REFERENCE,
  CURRENCIES,
} from './official-reference';
import { REVIEWED_REFERENCE_CHECKSUM } from './reference-dataset';
import {
  referenceModels,
  ReferenceCountry,
  ReferenceCity,
  ReferenceAirport,
  ReferenceAttraction,
  ReferenceCurrency,
} from './reference.schema';
import {
  CitiesQueryDto,
  LocationsQueryDto,
  ReferenceQueryDto,
  CountryDto,
  CityDto,
  AirportDto,
  AttractionDto,
  CurrencyDto,
} from './reference.dto';

@Injectable()
export class ReferenceDataService {
  private readonly models;
  constructor(@InjectConnection() connection: Connection) {
    this.models = referenceModels(connection);
  }
  private identifier(
    value: unknown,
    pattern: RegExp,
    uppercase: boolean,
  ): string {
    if (typeof value !== 'string')
      throw new BadRequestException('Invalid reference identifier');
    const normalized = uppercase ? value.toUpperCase() : value.toLowerCase();
    if (!pattern.test(normalized))
      throw new BadRequestException('Invalid reference identifier');
    return normalized;
  }
  private allowedIds(modelName: string): readonly string[] {
    switch (modelName) {
      case ReferenceCountry.name:
        return OFFICIAL_REFERENCE.countries.map((row) => row.code);
      case ReferenceCity.name:
        return OFFICIAL_REFERENCE.cities.map((row) => row.city_id);
      case ReferenceAirport.name:
        return OFFICIAL_REFERENCE.airports.map((row) => row.iata_code);
      case ReferenceAttraction.name:
        return OFFICIAL_REFERENCE.attractions.map((row) => row.attraction_id);
      case ReferenceCurrency.name:
        return CURRENCIES;
      default:
        throw new Error('Unknown reference model');
    }
  }
  private async ready() {
    if (
      !(await this.models.state.exists({
        _id: REFERENCE_SOURCE_ID,
        checksum: REVIEWED_REFERENCE_CHECKSUM,
      }))
    )
      throw new ServiceUnavailableException(
        'Official reference data must be seeded before lookup',
      );
  }
  private async one<T extends { _id: string }, V>(
    model: Model<T>,
    id: string,
    projection: Record<string, number>,
    message: string,
  ): Promise<V> {
    await this.ready();
    if (!this.allowedIds(model.modelName).includes(id))
      throw new NotFoundException(message);
    const record = await model.findById(id).select(projection).lean().exec();
    if (!record) throw new NotFoundException(message);
    return record as V;
  }
  private async page<T extends { _id: string }, V>(
    model: Model<T>,
    query: ReferenceQueryDto,
    identifier: string,
    projection: Record<string, number>,
    fields: Record<string, unknown> = {},
  ) {
    await this.ready();
    const match: Record<string, unknown> = {
      ...fields,
      _id: { $in: this.allowedIds(model.modelName) },
    };
    if (query.search) {
      const literal = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      match.$or = [
        { name: { $regex: literal, $options: 'i' } },
        { [identifier]: { $regex: literal, $options: 'i' } },
      ];
    }
    const [result] = await model
      .aggregate<{ data: V[]; total: { count: number }[] }>([
        { $match: match },
        {
          $facet: {
            data: [
              { $sort: { name: 1, _id: 1 } },
              { $skip: (query.page - 1) * 10 },
              { $limit: 10 },
              { $project: projection },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();
    const total = result.total[0]?.count ?? 0;
    return {
      data: result.data,
      meta: {
        page: query.page,
        limit: 10,
        total,
        totalPages: Math.ceil(total / 10),
      },
    };
  }
  async getCountry(code: string): Promise<CountryDto> {
    return this.one(
      this.models.countries,
      this.identifier(code, /^[A-Z]{2}$/, true),
      { _id: 0, code: 1, name: 1, currency: 1 },
      'Country not found',
    );
  }
  async getCity(id: string): Promise<CityDto> {
    return this.one(
      this.models.cities,
      this.identifier(id, /^[a-z][a-z0-9_-]{0,99}$/, false),
      { _id: 0, city_id: 1, name: 1, country_code: 1 },
      'City not found',
    );
  }
  async getAirport(code: string): Promise<AirportDto> {
    return this.one(
      this.models.airports,
      this.identifier(code, /^[A-Z]{3}$/, true),
      {
        _id: 0,
        iata_code: 1,
        name: 1,
        city_id: 1,
        country_code: 1,
        time_zone: 1,
      },
      'Airport not found',
    );
  }
  async getAttraction(id: string): Promise<AttractionDto> {
    return this.one(
      this.models.attractions,
      this.identifier(id, /^[a-z][a-z0-9_-]{0,99}$/, false),
      { _id: 0, attraction_id: 1, name: 1, city_id: 1 },
      'Attraction not found',
    );
  }
  async getCurrency(code: string): Promise<CurrencyDto> {
    return this.one(
      this.models.currencies,
      this.identifier(code, /^[A-Z]{3}$/, true),
      { _id: 0, code: 1 },
      'Currency not supported',
    );
  }
  countries(query: ReferenceQueryDto) {
    return this.page<ReferenceCountry, CountryDto>(
      this.models.countries,
      query,
      'code',
      {
        _id: 0,
        code: 1,
        name: 1,
        currency: 1,
      },
    );
  }
  async cities(query: CitiesQueryDto) {
    if (query.countryCode) await this.getCountry(query.countryCode);
    return this.page<ReferenceCity, CityDto>(
      this.models.cities,
      query,
      'city_id',
      { _id: 0, city_id: 1, name: 1, country_code: 1 },
      query.countryCode ? { country_code: query.countryCode } : {},
    );
  }
  private async locationFilter(query: LocationsQueryDto) {
    const fields: Record<string, string> = {};
    if (query.countryCode) {
      await this.getCountry(query.countryCode);
      fields.country_code = query.countryCode;
    }
    if (query.cityId) {
      const city = await this.getCity(query.cityId);
      if (query.countryCode && city.country_code !== query.countryCode)
        throw new BadRequestException('City does not belong to this country');
      fields.city_id = query.cityId;
    }
    return fields;
  }
  async airports(query: LocationsQueryDto) {
    return this.page<ReferenceAirport, AirportDto>(
      this.models.airports,
      query,
      'iata_code',
      {
        _id: 0,
        iata_code: 1,
        name: 1,
        city_id: 1,
        country_code: 1,
        time_zone: 1,
      },
      await this.locationFilter(query),
    );
  }
  async attractions(query: LocationsQueryDto) {
    const fields: Record<string, unknown> = await this.locationFilter(query);
    if (query.countryCode) {
      delete fields.country_code;
      if (!query.cityId)
        fields.city_id = {
          $in: (
            await this.models.cities
              .find({ country_code: query.countryCode })
              .select({ city_id: 1 })
              .lean()
          ).map((city) => city.city_id),
        };
    }
    return this.page<ReferenceAttraction, AttractionDto>(
      this.models.attractions,
      query,
      'attraction_id',
      { _id: 0, attraction_id: 1, name: 1, city_id: 1 },
      fields,
    );
  }
  currencies(query: ReferenceQueryDto) {
    return this.page<ReferenceCurrency, CurrencyDto>(
      this.models.currencies,
      query,
      'code',
      { _id: 0, code: 1 },
    );
  }
}

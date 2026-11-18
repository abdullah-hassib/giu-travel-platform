import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Airport } from './schemas/airport.schema';
import { FindAirportsDto } from './dto/find-airports.dto';
import { CITIES } from '../itineraries/reference-data';

@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Airport.name)
    private readonly airports: Model<Airport>,
  ) {}

  async findAll(query: FindAirportsDto) {
    const filter: FilterQuery<Airport> = {};

    if (query.cityId) {
      filter.cityId = query.cityId;
    }

    if (query.countryCode) {
      filter.countryCode = query.countryCode;
    }

    if (query.search) {
      const searchTerm = query.search.trim();
      const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');

      const matchingCityIds = CITIES
        .filter((city) =>
          city.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          city.id.toLowerCase().includes(searchTerm.toLowerCase()),
        )
        .map((city) => city.id);

      filter.$or = [
        { iataCode: searchRegex },
        { name: searchRegex },
        { cityId: searchRegex },
        ...(matchingCityIds.length > 0
          ? [{ cityId: { $in: matchingCityIds } }]
          : []),
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.airports
        .find(filter)
        .sort({ iataCode: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.airports.countDocuments(filter).exec(),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByIataCode(iataCode: string): Promise<Airport> {
    const normalizedCode = iataCode.trim().toUpperCase();

    const airport = await this.airports
      .findOne({ iataCode: normalizedCode })
      .exec();

    if (!airport) {
      throw new NotFoundException('Airport not found');
    }

    return airport;
  }
}

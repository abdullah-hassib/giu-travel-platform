import { NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { Airport } from './schemas/airport.schema';
import { ReferenceDataService } from './reference-data.service';

describe('ReferenceDataService', () => {
  let service: ReferenceDataService;
  let airports: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(() => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    airports = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    };

    service = new ReferenceDataService(
      airports as unknown as Model<Airport>,
    );
  });

  describe('findAll', () => {
    it('should return airports with pagination', async () => {
      const airport = { iataCode: 'CAI' };
      const findQuery = airports.find();
      findQuery.exec.mockResolvedValue([airport]);

      airports.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items).toEqual([airport]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('should filter by city and country', async () => {
      await service.findAll({
        cityId: 'cairo',
        countryCode: 'EG',
        page: 1,
        limit: 10,
      });

      expect(airports.find).toHaveBeenCalledWith({
        cityId: 'cairo',
        countryCode: 'EG',
      });
    });

    it('should include the matching city ID when searching by city name', async () => {
      await service.findAll({ search: 'New York', page: 1, limit: 10 });

      const filter = airports.find.mock.calls[0][0];

      expect(filter.$or).toContainEqual({
        cityId: { $in: ['new_york'] },
      });
    });

    it('should escape special regular expression characters in search', async () => {
      await service.findAll({ search: 'CAI.*', page: 1, limit: 10 });

      const filter = airports.find.mock.calls[0][0];

      expect(filter.$or[0].iataCode.source).toBe('CAI\\.\\*');
    });

    it('should apply the requested pagination', async () => {
      const findQuery = airports.find();
      findQuery.exec.mockResolvedValue([]);

      await service.findAll({ page: 2, limit: 5 });

      expect(findQuery.skip).toHaveBeenCalledWith(5);
      expect(findQuery.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('findByIataCode', () => {
    it('should normalize the IATA code before searching', async () => {
      const airport = { iataCode: 'CAI' };

      airports.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(airport),
      });

      const result = await service.findByIataCode(' cai ');

      expect(airports.findOne).toHaveBeenCalledWith({
        iataCode: 'CAI',
      });
      expect(result).toEqual(airport);
    });

    it('should throw NotFoundException for an unknown airport', async () => {
      await expect(
        service.findByIataCode('XXX'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});




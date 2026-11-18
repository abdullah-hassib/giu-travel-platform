import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { Airport } from '../modules/reference-data/schemas/airport.schema';
import {
  CITIES,
  COUNTRIES,
} from '../modules/itineraries/reference-data';

const AIRPORTS = [
  { iataCode: 'CAI', name: 'Cairo International Airport', cityId: 'cairo', countryCode: 'EG', timeZone: 'Africa/Cairo' },
  { iataCode: 'DXB', name: 'Dubai International Airport', cityId: 'dubai', countryCode: 'AE', timeZone: 'Asia/Dubai' },
  { iataCode: 'LHR', name: 'Heathrow Airport', cityId: 'london', countryCode: 'GB', timeZone: 'Europe/London' },
  { iataCode: 'JFK', name: 'John F. Kennedy International Airport', cityId: 'new_york', countryCode: 'US', timeZone: 'America/New_York' },
  { iataCode: 'CDG', name: 'Charles de Gaulle Airport', cityId: 'paris', countryCode: 'FR', timeZone: 'Europe/Paris' },
  { iataCode: 'HND', name: 'Tokyo Haneda Airport', cityId: 'tokyo', countryCode: 'JP', timeZone: 'Asia/Tokyo' },
  { iataCode: 'RUH', name: 'King Khalid International Airport', cityId: 'riyadh', countryCode: 'SA', timeZone: 'Asia/Riyadh' },
  { iataCode: 'FRA', name: 'Frankfurt Airport', cityId: 'frankfurt', countryCode: 'DE', timeZone: 'Europe/Berlin' },
] as const;

function validateAirports(): void {
  const cityIds = new Set(CITIES.map((city) => city.id));
  const countryCodes = new Set(COUNTRIES.map((country) => country.code));
  const iataCodes = new Set<string>();

  for (const airport of AIRPORTS) {
    if (iataCodes.has(airport.iataCode)) {
      throw new Error(`Duplicate IATA code in seed data: ${airport.iataCode}`);
    }
    iataCodes.add(airport.iataCode);

    if (!cityIds.has(airport.cityId as (typeof CITIES)[number]['id'])) {
      throw new Error(`Unknown city reference for ${airport.iataCode}`);
    }

    if (!countryCodes.has(airport.countryCode as (typeof COUNTRIES)[number]['code'])) {
      throw new Error(`Unknown country reference for ${airport.iataCode}`);
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: airport.timeZone });
    } catch {
      throw new Error(`Invalid IANA timezone for ${airport.iataCode}: ${airport.timeZone}`);
    }
  }
}

async function main(): Promise<void> {
  validateAirports();

  const context = await NestFactory.createApplicationContext(AppModule);

  try {
    const airportModel = context.get<Model<Airport>>(getModelToken(Airport.name));

    const operations = AIRPORTS.map((airport) => ({
      updateOne: {
        filter: { iataCode: airport.iataCode },
        update: { $set: airport },
        upsert: true,
      },
    }));

    const result = await airportModel.bulkWrite(operations);

    process.stdout.write(
      `Airport seed completed: ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${AIRPORTS.length} total.\n`,
    );
  } finally {
    await context.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Airport seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});

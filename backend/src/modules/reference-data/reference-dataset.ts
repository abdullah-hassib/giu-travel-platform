import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { OFFICIAL_REFERENCE, CURRENCIES } from './official-reference';

export interface CountryRow {
  code: string;
  name: string;
  currency: string;
}
export interface CityRow {
  city_id: string;
  name: string;
  country_code: string;
}
export interface AirportRow {
  iata_code: string;
  name: string;
  city_id: string;
  country_code: string;
  time_zone: string;
}
export interface AttractionRow {
  attraction_id: string;
  name: string;
  city_id: string;
}
export interface ReferenceDataset {
  countries: readonly CountryRow[];
  cities: readonly CityRow[];
  airports: readonly AirportRow[];
  attractions: readonly AttractionRow[];
  currencies: readonly string[];
}
export type CsvSources = {
  Countries: string;
  Cities: string;
  Airports: string;
  Attractions: string;
};
export const REVIEWED_REFERENCE: ReferenceDataset = {
  ...OFFICIAL_REFERENCE,
  currencies: CURRENCIES,
};

function rows<T>(text: string, fields: string[]): T[] {
  let result: unknown;
  try {
    result = parse(text, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 4096,
      columns: (headers: string[]) => {
        if (
          headers.length !== fields.length ||
          headers.some((field, index) => field !== fields[index])
        )
          throw new Error('Invalid headers');
        return headers;
      },
    });
  } catch {
    throw new Error('Reference CSV has invalid headers, columns or quoting');
  }
  if (!Array.isArray(result) || !result.length)
    throw new Error('Reference CSV must contain records');
  for (const item of result) {
    if (!item || typeof item !== 'object')
      throw new Error('Invalid reference record');
    const record = item as Record<string, unknown>;
    if (
      fields.some(
        (field) =>
          typeof record[field] !== 'string' ||
          !(record[field] as string).length ||
          (record[field] as string).trim() !== record[field],
      )
    )
      throw new Error(
        'Reference fields must be nonempty strings without surrounding whitespace',
      );
  }
  return result as T[];
}

function unique(values: readonly string[], pattern: RegExp, label: string) {
  if (
    !values.length ||
    values.some((value) => typeof value !== 'string' || !pattern.test(value)) ||
    new Set(values).size !== values.length
  )
    throw new Error('Invalid or duplicate reference ' + label);
}
export function validateReferenceDataset(data: ReferenceDataset): void {
  unique(
    data.countries.map((r) => r.code),
    /^[A-Z]{2}$/,
    'country codes',
  );
  unique(
    data.cities.map((r) => r.city_id),
    /^[a-z][a-z0-9_-]{0,99}$/,
    'city identifiers',
  );
  unique(
    data.airports.map((r) => r.iata_code),
    /^[A-Z]{3}$/,
    'airport codes',
  );
  unique(
    data.attractions.map((r) => r.attraction_id),
    /^[a-z][a-z0-9_-]{0,99}$/,
    'attraction identifiers',
  );
  unique(data.currencies, /^[A-Z]{3}$/, 'currencies');
  const currencies = [...new Set(data.countries.map((r) => r.currency))];
  if (
    currencies.some((currency) => !/^[A-Z]{3}$/.test(currency)) ||
    JSON.stringify(currencies) !== JSON.stringify(data.currencies)
  )
    throw new Error('Supported currencies must match Countries.csv');
  const countries = new Set(data.countries.map((r) => r.code));
  const cities = new Map(data.cities.map((r) => [r.city_id, r]));
  if (data.cities.some((r) => !countries.has(r.country_code)))
    throw new Error('City references a missing country');
  for (const airport of data.airports) {
    if (
      !cities.has(airport.city_id) ||
      cities.get(airport.city_id)!.country_code !== airport.country_code
    )
      throw new Error('Airport city/country relationship is invalid');
    if (!/^(?:[A-Za-z_+-]+\/)+[A-Za-z_+-]+$|^UTC$/.test(airport.time_zone))
      throw new Error('Invalid airport IANA time zone');
    try {
      new Intl.DateTimeFormat('en', { timeZone: airport.time_zone }).format();
    } catch {
      throw new Error('Invalid airport IANA time zone');
    }
  }
  if (data.attractions.some((r) => !cities.has(r.city_id)))
    throw new Error('Attraction references a missing city');
  for (const group of [
    data.countries,
    data.cities,
    data.airports,
    data.attractions,
  ])
    if (
      group.some(
        (r) =>
          typeof r.name !== 'string' || !r.name.trim() || r.name.length > 500,
      )
    )
      throw new Error('Invalid reference name');
}

export function parseReferenceCsv(sources: CsvSources): ReferenceDataset {
  const countries = rows<CountryRow>(sources.Countries, [
    'code',
    'name',
    'currency',
  ]);
  const data: ReferenceDataset = {
    countries,
    cities: rows<CityRow>(sources.Cities, ['city_id', 'name', 'country_code']),
    airports: rows<AirportRow>(sources.Airports, [
      'iata_code',
      'name',
      'city_id',
      'country_code',
      'time_zone',
    ]),
    attractions: rows<AttractionRow>(sources.Attractions, [
      'attraction_id',
      'name',
      'city_id',
    ]),
    currencies: [...new Set(countries.map((country) => country.currency))],
  };
  validateReferenceDataset(data);
  return data;
}
export function referenceChecksum(data: ReferenceDataset): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
export const REVIEWED_REFERENCE_CHECKSUM =
  referenceChecksum(REVIEWED_REFERENCE);
export function loadOfficialReferenceDataset(): ReferenceDataset {
  const directory = resolve(__dirname, '../../../data/reference');
  const read = (name: keyof CsvSources) =>
    readFileSync(resolve(directory, name + '.csv'), 'utf8');
  const data = parseReferenceCsv({
    Countries: read('Countries'),
    Cities: read('Cities'),
    Airports: read('Airports'),
    Attractions: read('Attractions'),
  });
  if (referenceChecksum(data) !== REVIEWED_REFERENCE_CHECKSUM)
    throw new Error(
      'Reference CSVs do not match the reviewed official snapshot',
    );
  return data;
}

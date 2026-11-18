import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CsvSources,
  loadOfficialReferenceDataset,
  parseReferenceCsv,
  REVIEWED_REFERENCE,
  REVIEWED_REFERENCE_CHECKSUM,
  referenceChecksum,
} from './reference-dataset';
import { COUNTRIES, CITIES, CURRENCIES } from './official-reference';
import * as compatibility from '../itineraries/reference-data';

function sources(): CsvSources {
  const read = (file: string) =>
    readFileSync(
      resolve(__dirname, '../../../data/reference', file + '.csv'),
      'utf8',
    );
  return {
    Countries: read('Countries'),
    Cities: read('Cities'),
    Airports: read('Airports'),
    Attractions: read('Attractions'),
  };
}
describe('Official reference CSV ingestion', () => {
  it('preserves every supplied record, identifier, relationship, currency and time zone', () => {
    const data = loadOfficialReferenceDataset();
    expect(data).toEqual(REVIEWED_REFERENCE);
    expect(data.countries).toHaveLength(8);
    expect(data.cities).toHaveLength(8);
    expect(data.airports).toHaveLength(8);
    expect(data.attractions).toHaveLength(8);
    expect(data.currencies).toEqual([
      'EGP',
      'AED',
      'GBP',
      'USD',
      'EUR',
      'JPY',
      'SAR',
    ]);
    expect(
      data.airports.find((row) => row.iata_code === 'CAI')!.time_zone,
    ).toBe('Africa/Cairo');
    expect(
      data.attractions.find((row) => row.attraction_id === 'att-8')!.name,
    ).toBe('Römerberg');
    expect(referenceChecksum(data)).toBe(REVIEWED_REFERENCE_CHECKSUM);
  });
  it('retains compatible shared objects for existing itinerary/user/FX consumers', () => {
    expect(compatibility.COUNTRIES).toBe(COUNTRIES);
    expect(compatibility.CITIES).toBe(CITIES);
    expect(compatibility.CURRENCIES).toBe(CURRENCIES);
  });
  it('handles BOM/CRLF and proper quoted CSV without corrupting Unicode or commas', () => {
    const csv = sources();
    // Git may have checked out CRLF already; normalize before constructing
    // the deliberately BOM-prefixed CRLF fixture.
    csv.Attractions =
      '\uFEFF' +
      csv.Attractions.replace(/\r\n?/g, '\n')
        .replace('Giza Pyramids and Sphinx', '"Giza, Pyramids and ""Sphinx"""')
        .replace(/\n/g, '\r\n');
    const data = parseReferenceCsv(csv);
    expect(data.attractions[0].name).toBe('Giza, Pyramids and "Sphinx"');
    expect(data.attractions[7].name).toBe('Römerberg');
  });
  it.each([
    [
      'missing header',
      (s: CsvSources) => {
        s.Countries = s.Countries.replace(
          'code,name,currency',
          'name,currency',
        );
      },
    ],
    [
      'unknown column',
      (s: CsvSources) => {
        s.Cities = s.Cities.replace(
          'city_id,name,country_code',
          'city_id,name,country_code,extra',
        );
      },
    ],
    [
      'duplicate header',
      (s: CsvSources) => {
        s.Airports = s.Airports.replace(
          'city_id,country_code',
          'city_id,city_id',
        );
      },
    ],
    [
      'empty file',
      (s: CsvSources) => {
        s.Attractions = '';
      },
    ],
    [
      'only header',
      (s: CsvSources) => {
        s.Countries = 'code,name,currency\n';
      },
    ],
    [
      'bad quoting',
      (s: CsvSources) => {
        s.Countries += '"broken\n';
      },
    ],
    [
      'ragged record',
      (s: CsvSources) => {
        s.Cities += 'other,Other\n';
      },
    ],
    [
      'blank name',
      (s: CsvSources) => {
        s.Cities = s.Cities.replace('cairo,Cairo,EG', 'cairo,,EG');
      },
    ],
    [
      'whitespace identifier',
      (s: CsvSources) => {
        s.Cities = s.Cities.replace('cairo,Cairo', ' cairo,Cairo');
      },
    ],
    [
      'duplicate country',
      (s: CsvSources) => {
        s.Countries += 'EG,Egypt,EGP\n';
      },
    ],
    [
      'duplicate city',
      (s: CsvSources) => {
        s.Cities += 'cairo,Cairo,EG\n';
      },
    ],
    [
      'duplicate airport',
      (s: CsvSources) => {
        s.Airports += 'CAI,Cairo International Airport,cairo,EG,Africa/Cairo\n';
      },
    ],
    [
      'duplicate attraction',
      (s: CsvSources) => {
        s.Attractions += 'att-1,Other,cairo\n';
      },
    ],
    [
      'bad country code',
      (s: CsvSources) => {
        s.Countries = s.Countries.replace('EG,Egypt', 'eg,Egypt');
      },
    ],
    [
      'bad currency code',
      (s: CsvSources) => {
        s.Countries = s.Countries.replace('Egypt,EGP', 'Egypt,egp');
      },
    ],
    [
      'city with foreign country',
      (s: CsvSources) => {
        s.Cities = s.Cities.replace('cairo,Cairo,EG', 'cairo,Cairo,ZZ');
      },
    ],
    [
      'airport with foreign city',
      (s: CsvSources) => {
        s.Airports = s.Airports.replace(
          'Airport,cairo,EG',
          'Airport,missing,EG',
        );
      },
    ],
    [
      'airport with wrong country',
      (s: CsvSources) => {
        s.Airports = s.Airports.replace('cairo,EG,Africa', 'cairo,US,Africa');
      },
    ],
    [
      'unsupported time zone',
      (s: CsvSources) => {
        s.Airports = s.Airports.replace('Africa/Cairo', 'Unknown/Nowhere');
      },
    ],
    [
      'numeric offset instead of IANA zone',
      (s: CsvSources) => {
        s.Airports = s.Airports.replace('Africa/Cairo', '+02:00');
      },
    ],
    [
      'attraction with foreign city',
      (s: CsvSources) => {
        s.Attractions = s.Attractions.replace('Sphinx,cairo', 'Sphinx,missing');
      },
    ],
    [
      'oversized record',
      (s: CsvSources) => {
        s.Attractions = s.Attractions.replace(
          'Giza Pyramids and Sphinx',
          'x'.repeat(5000),
        );
      },
    ],
  ] as const)('rejects %s before database writes', (_label, mutate) => {
    const csv = sources();
    mutate(csv);
    expect(() => parseReferenceCsv(csv)).toThrow();
  });
});

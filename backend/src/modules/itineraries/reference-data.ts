// Read-only snapshot of the official reference workbook, modified 2026-11-01.
// https://drive.google.com/file/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/view
// Preserves source identifiers. No database seeding or reference API is performed here.
export const COUNTRIES = [
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
] as const;

export const CITIES = [
  { id: 'cairo', name: 'Cairo', countryCode: 'EG' },
  { id: 'dubai', name: 'Dubai', countryCode: 'AE' },
  { id: 'london', name: 'London', countryCode: 'GB' },
  { id: 'new_york', name: 'New York', countryCode: 'US' },
  { id: 'paris', name: 'Paris', countryCode: 'FR' },
  { id: 'tokyo', name: 'Tokyo', countryCode: 'JP' },
  { id: 'riyadh', name: 'Riyadh', countryCode: 'SA' },
  { id: 'frankfurt', name: 'Frankfurt', countryCode: 'DE' },
] as const;

export const COUNTRY_CODES = COUNTRIES.map((country) => country.code);
export const CITY_IDS = CITIES.map((city) => city.id);
export const CURRENCIES = [
  ...new Set(COUNTRIES.map((country) => country.currency)),
];

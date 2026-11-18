# Official GIU reference data

Source: [official reference workbook](https://drive.google.com/file/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/view), titled Mock Data, modified 2026-11-01T12:14:46.761Z. Retrieved November 18, 2026 through the connected Drive reader.

These four UTF-8 CSVs are exports of the supplied Countries, Cities, Airports and Attractions tabs. The reader's display-only row-number column was omitted. All actual source headers, values and natural identifiers are preserved; no substitute data or identifiers were invented. Each file has eight data records. Seven supported currency codes derive from Countries.csv; there is no invented currency-name dataset.

The matching reviewed TypeScript snapshot lives in src/modules/reference-data/official-reference.ts. Existing user/itinerary/FX validation shares it through a compatibility export. The seed loader validates every relationship and compares the CSV dataset with that snapshot before database access. Tests enforce exact equality. Review CSV/snapshot changes together when the university supplies a new edition; do not silently add custom locations.

Validation: from backend, run npm run seed:reference. It validates offline and prints only counts and a checksum. Database application and module handoff are documented in docs/REFERENCE_DATA.md.

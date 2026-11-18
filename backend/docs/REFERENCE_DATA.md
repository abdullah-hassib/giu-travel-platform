# Official reference data: setup, API and handoff

November 18, 2026. Implements Kuwaity's reference-data assignment, explicitly added to the assistant's scope by Hassib. Relevant requirements are GEN-12 (setup seeding), FLT-02 (read-only airports), GEN-05 (ten-row lists), GEN-13 (backend validation), with location/currency support for hotels, itineraries and budgets. This is separate from Hassib's 36-row personal coverage count.

The personal Kuwaity task brief assigns reference datasets, seeding and location lookups. A separate detailed guide describes payments under Kuwaity's name and conflicts with that allocation. The personal task brief, existing recorded team allocation and official PDF/workbook were used for this slice. Payment work stays in its existing separate branches.

## Data and persistence

The four CSVs in data/reference were exported from the official workbook's November 1 edition, retaining its headers and identifiers. They contain eight countries, eight cities, eight airports and eight attractions. Seven unique currencies derive from countries. Source/provenance is recorded beside those files. Airport IANA zones and Unicode names are preserved exactly.

Collections are reference_countries, reference_cities, reference_airports, reference_attractions and reference_currencies. Their string _id uses the original country code, city_id, iata_code, attraction_id or currency code respectively; original source identifier fields are retained too. Airport city/country and attraction city relationships are validated before any database write. Country/city indexes support location filters, and natural _id indexes provide unique indexed lookup.

The seed validates strict headers/quoting/columns, nonempty fields, unique identifier syntax, valid IANA zones and referential relationships. Its checksum must match the reviewed shared snapshot. All upserts and the reference_seed_state readiness manifest commit in one transaction. Collections/indexes initialize before that transaction. Repeating or concurrently running the seed converges on the same natural identifiers; no collection is dropped, unrelated data is untouched and extra rows are not deleted. Public lookups admit only reviewed official identifiers, so custom database rows are not published.

The API reports 503 while this edition is unseeded, rather than silently substituting fabricated or stale database data. After seeding, a missing valid identifier returns 404. An invalid identifier/filter returns 400. No HTTP mutation route is exposed.

## Run and demonstrate

From backend:

```powershell
npm run seed:reference
```

This is offline validation only: eight rows per source, seven currencies and the reviewed checksum. It neither loads .env nor opens a database connection.

To apply to the designated database, supply MONGODB_URI privately in the invoking process, then run:

```powershell
npm run seed:reference -- --apply
```

If private configuration is only in backend/.env, the developer can explicitly load it using the installed Node 24 runtime:

```powershell
node --env-file=.env -r ts-node/register src/scripts/seed-reference.ts --apply
```

Use the team's designated database and obtain the required team approval for a shared Atlas seed. The implementation's verification uses disposable local replica sets; no shared Atlas seed is claimed. Do not print or paste the URI. The CLI deliberately avoids AppModule, user/admin seeds and background payment jobs. Output contains only validation/count results or a fixed safe failure message, never driver diagnostics or database credentials. Transactions require a replica set (Atlas or the disposable local test replica set).

Start the backend normally and open http://localhost:3000/api/docs. Try GET /api/airports?cityId=cairo, then GET /api/airports/CAI; confirm Africa/Cairo. GET /api/currencies returns the seven source codes. GET /api/airports?countryCode=US&cityId=cairo returns 400; a nonexistent valid code returns 404. Rerun the seed and verify counts remain unchanged.

## Public read-only API

| Collection | List | Detail | Optional list filters |
| --- | --- | --- | --- |
| Countries | GET /api/countries | GET /api/countries/:code | search |
| Cities | GET /api/cities | GET /api/cities/:id | countryCode, search |
| Airports | GET /api/airports | GET /api/airports/:code | countryCode, cityId, search |
| Attractions | GET /api/attractions | GET /api/attractions/:id | countryCode, cityId, search |
| Supported currencies | GET /api/currencies | GET /api/currencies/:code | search |

All list routes also accept page (default 1), return data plus meta { page, limit:10, total, totalPages }, and use a stable name/identifier order. Pages past the end return an empty array with truthful totals. Search is a literal case-insensitive substring of name or natural identifier, with a 100-character limit. Query fields are allowlisted; arbitrary limits, sort keys, arrays and Mongo operators are rejected. Known code casing is normalized; source values are not rewritten.

Responses retain the official source field names: code/name/currency for countries; city_id/name/country_code for cities; iata_code/name/city_id/country_code/time_zone for airports; attraction_id/name/city_id for attractions; code for currencies. Persistence IDs/version data are excluded. Routes are public reference reads with no session requirement; they grant no provider management or booking permissions. Swagger documents the validated query/response/error schemas and all responses use no-store.

## Reuse from other modules

Import ReferenceDataModule and inject ReferenceDataService. getCountry(code), getCity(id), getAirport(iata), getAttraction(id) and getCurrency(code) provide positively projected records and 400/404/503 errors. getAirport('CAI').time_zone is Adham's authoritative IANA zone. Hotel owners validate their city/country through those lookups; airport country must match its source city. Do not create a second /api/airports controller or fabricate ObjectIds in place of supplied natural IDs.

countries/cities/airports/attractions/currencies expose the paginated read operations using their DTOs. For internal list use, instantiate the appropriate query DTO to retain its default page. These read methods do not perform booking availability, pricing or inventory authorization; those remain with booking/provider owners.

Existing itinerary, user-schema and FX code still needs synchronous validation during schema construction. All current consumers now import the single reviewed reference-data snapshot directly. The original itinerary import path remains a compatibility re-export instead of maintaining a second list. This preserves all existing identifiers and behavior while guaranteeing the seed and synchronous validation agree. Adham/MK's unpublished code cannot yet be rewired here; their service imports are the remaining integration handoff.

## Verification

The unit suite checks exact source/snapshot compatibility, all currencies/time zones/relationships, BOM/CRLF/quoted Unicode CSV and invalid/duplicate/broken input. HTTP/database tests load the actual module/validation/Swagger on disposable MongoDB replica sets, test seeding/reseeding/concurrency/rollback, read-only access, filtering/search/pagination, unsupported input, source-only visibility and shared-service lookup. They also run the compiled CLI in validation-only mode and apply it twice to a fresh disposable database.

The new dependency is pinned csv-parse 7.0.3 with CommonJS exports verified before installation. The dependency audit reports 71 findings in the existing graph (3 low, 15 moderate, 53 high), with no csv-parse advisory. No unrelated dependency upgrades or forced audit fixes were applied in this requirement slice.

# Itinerary core

## Requirement coverage

| Requirement | This slice |
| --- | --- |
| ITN-01, ITN-03 | Private creation, owner CRUD, title/countries/start-date validation, newest-updated list |
| ITN-05 | Ordered days, required official city, derived dates, maximum 60 days |
| ITN-07, ITN-08 | Delete/reorder days; recalculate numbering, dates, consecutive city groups and activity costs. Full original-currency budget totals are now included; see BUDGETING.md. |
| ITN-09 | Consecutive city groups and original-currency activity subtotals. Full original-currency budget subtotals are now included. |
| ITN-10 | Activity CRUD, description, optional local HH:mm time and original-currency cost |
| ITN-20 | Public/private visibility; public reads/search immediately respect changes |
| ITN-21 core | Public search/read and independent private cloning of current days/activities/costs with attribution. Budget and transport copying is now included; image integration remains pending. |
| ACC-11, GEN-05, GEN-13 | Ownership, server validation, role guards and fixed ten-row pagination |

This is a working itinerary core. Budget entries and transport costs are implemented in the native-budgeting slice. FX conversion, activity images and flight/hotel search integration remain separate slices. Administration status PR #9 remains deferred and unmerged.

## Reference-data provenance

The read-only `reference-data.ts` snapshot contains the eight country and eight city records from the official reference workbook linked in the project PDF, last modified November 1, 2026. The source workbook is titled “Mock Data”; the records were supplied by GIU, and were not fabricated for this implementation. All source country codes, city IDs, names, country relationships and supported currency codes are preserved. [Official reference workbook](https://drive.google.com/file/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/view)

This snapshot is used only for itinerary validation, display labels and keyword matching. Kuwaity's reference-data module, database seeding and APIs remain separate work. Future integration must retain the same identifiers and reconcile snapshot updates with his authoritative service. This slice does not claim GEN-12 seeding completion.

## Routes and access

| Method | Path | Response |
| --- | --- | --- |
| POST | /api/itineraries | 201 full view |
| GET | /api/itineraries | 200 paginated own views |
| GET/PATCH | /api/itineraries/:id | 200 full view |
| DELETE | /api/itineraries/:id | 204 |
| POST | /api/itineraries/:id/days | 201 updated parent view |
| PATCH | /api/itineraries/:id/days/:dayId | 200 updated parent view |
| DELETE | /api/itineraries/:id/days/:dayId | 200 updated parent view |
| PATCH | /api/itineraries/:id/days/reorder | 200 updated parent view |
| POST | /api/itineraries/:id/days/:dayId/activities | 201 updated parent view |
| PATCH/DELETE | /api/activities/:id | 200 updated parent view |
| GET | /api/itineraries/public/search | 200 paginated public views |
| GET | /api/itineraries/public/:id | 200 public view with author |
| POST | /api/itineraries/:id/clone | 201 new private view |

Authoring, own reads and cloning require an active traveler-role session. A multi-role account with traveler access can author its own data. Staff-only roles receive 403; guests receive 401. Private itinerary access remains owner-only, including for administrator accounts. Foreign and missing resources both return 404. Mandatory-password-change sessions receive 403 for protected itinerary operations.

Public routes are guest-readable and read-only. Deactivated/deleted authors are excluded. Suspended authors' public content remains visible, following ACC-16. Every route returns `Cache-Control: no-store` so visibility changes are applied on subsequent reads.

## Requests and validation

Create with `{ "title": "Cairo trip", "countryCodes": ["EG"], "startDate": "2026-11-20" }`. Titles are trimmed, nonempty and at most 100 characters. Countries must be unique official codes. Dates are strict real calendar dates in YYYY-MM-DD format; past itinerary dates are allowed. Parent patch accepts the same optional fields and `visibility` (`private` or `public`). Required fields cannot be cleared with null.

Day creation takes `{ "cityId": "cairo", "notes": "Optional notes" }`. Each city must belong to a selected itinerary country. Removing a country still used by a day is rejected atomically. Notes can be cleared with null. Reorder takes `{ "dayIds": [...] }` containing every existing day exactly once. ObjectId casing is normalized, including duplicate detection.

Activity creation takes `{ "name": "Museum", "description": "Optional", "time": "14:30", "cost": { "amountMinor": 10000, "currency": "EGP" } }`. Name is required and trimmed. Time is optional HH:mm local itinerary-day time. Cost uses a non-negative safe integer in minor units and a currency from the official countries workbook. Optional description/time/cost can be cleared using null. Unknown fields, nested operator objects, malformed IDs and cost arrays are rejected.

Own lists accept only `page`. Public search accepts `page`, `search`, `countryCode`, `cityId`, `minDays` and `maxDays`. Keyword matching is literal/case-insensitive across title and official country/city names. Duration bounds are inclusive 0–60, with min <= max. All lists use page size 10, updatedAt descending and ObjectId descending for ties. Empty matches report totalPages 0.

## Consistency, money and cloning

Days and activities are embedded under one owner itinerary. Dates/day numbers are derived from the array order and start date; consecutive equal cities form separate groups when interrupted by another city. Group `activityTotals` contains original-currency activity-only totals in minor units. Full native budgetTotals/budgetSummary include budget entries, activities and transport with separate original currencies; FX conversion remains pending. Amounts and totals exceeding JavaScript's safe-integer range are rejected before persistence. Dates beyond the supported four-digit calendar range are also rejected.

Optimistic concurrency protects all read/modify/save operations. A raced update returns 409 and the client must reload/retry. This also prevents concurrent additions exceeding the sixty-day cap. Deleting a day deletes its embedded activities/costs in the same parent update. Parent deletion removes that parent and embedded data. Frontend confirmation dialogs belong to the M2 workflow.

Clones copy days, notes, activities, times, costs, budgets and transport with fresh identifiers and valid cloned-day references. They get new parent/day/activity IDs, private visibility, the new owner, and a `clonedFrom` snapshot of source itinerary ID, author ID and public display name. Editing, hiding or deleting the source does not alter existing clones. Budget/transport clone coverage is now verified; future media support must extend clone tests before the remaining requirement is marked complete.

## Demo and verification

Log in as a traveler, create the example itinerary, add a Cairo day and an activity, then inspect derived dates/groups. Add more days, reorder them and change the start date. Publish the itinerary and read/search it as a guest. Log in as a second traveler and clone it; inspect its private visibility and attribution. Hide/delete the source and verify the clone remains readable by its owner. A different traveler must receive 404 for private reads/edits and activity mutations.

The test suite loads the real ItinerariesModule/AuthModule, guards and disposable local MongoDB. It exercises privacy, role/owner boundaries, reference validation, calendar edges, day limits, concurrent edits, cost precision/clearing, public search, author status, cloning and generated Swagger. It never loads `.env` or accesses shared Atlas. Follow the existing README test-binary instructions for `npm run test:e2e`.

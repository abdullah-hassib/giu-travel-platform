# Original-currency budgeting

## Coverage

This slice implements daily budget CRUD (ITN-14), intercity transport CRUD (ITN-16), and original-currency breakdowns. It extends day deletion/reordering/grouping and clone coverage under ITN-07/08/09/21. ITN-18 conversion, daily FX cache/fallback and preferred-currency display remain pending. The user confirmed that no FXRatesAPI key is configured.

## API

| Method | Path | Body / result |
| --- | --- | --- |
| POST | /api/itineraries/:id/days/:dayId/budgets | category, amountMinor, currency; 201 updated itinerary |
| PATCH | /api/budgets/:id | Optional category/amountMinor/currency; 200 updated itinerary |
| DELETE | /api/budgets/:id | 200 updated itinerary |
| POST | /api/itineraries/:id/transport-costs | dayId, mode, fromCityId, toCityId, amountMinor, currency; 201 updated itinerary |
| PATCH | /api/transport-costs/:id | Optional creation fields, including an owned destination dayId; 200 updated itinerary |
| DELETE | /api/transport-costs/:id | 200 updated itinerary |
| GET | /api/itineraries/:id/budget-summary | Native totals by category/day; 200 |

All routes require active traveler-role access and parent ownership. Guests receive 401, staff-only/restricted-password sessions 403, and foreign/missing resources 404. DTOs reject unknown fields, malformed IDs, negative/fractional/unsafe amounts and unsupported currencies/categories/cities. Required fields cannot be null. Responses use no-store and documented Swagger schemas. Concurrent edits return 409; reload/retry.

Categories are `food`, `accommodation`, `in_city_transport` and `activities`. Amounts are non-negative integer minor units, including zero, using currency codes from the official-country snapshot. Transport mode is trimmed nonempty text; endpoints must be official cities, and dayId must belong to this itinerary. The workbook supplies no additional mode enumeration or country restriction for transport endpoints, so none is invented here.

The summary accepts no query fields. Unsupported conversion requests such as `?currency=USD` return 400. Future FX integration will add an explicit validated conversion contract.

## Consistency and totals

Entries are embedded under their assigned day and reuse the existing itinerary optimistic save/ownership path. Moving transport preserves its entry ID and changes the containing day. Day references/dates/numbers derive from containment. Deleting a day atomically removes its budget, transport and activities. Reordering/start-date changes update all breakdowns.

`budgetSummary.totalByCurrency` contains complete native totals. `byCategory` has the four budget categories plus `intercity_transport`; explicit Activities entries and activity costs both count under Activities. `byDay` includes day ID/number/date and the same breakdown. `cityGroups[].budgetTotals` includes all consecutive-day costs. Existing `activityTotals` remains activity-only for compatibility.

Currencies stay separate. Safe-integer checks apply across combined cost sources and reject overflow before persistence. No derived total is stored. Public views include the original-currency budgets/summary. Clones receive fresh budget/transport/day IDs and point transport at the cloned days. Source and clone remain independent. Older records missing the new arrays are interpreted as empty.

## Demo and verification

As a traveler, add `{ "category": "food", "amountMinor": 10000, "currency": "EGP" }` to a Cairo day. Add an activity cost and `{ "dayId": "<existing-day-id>", "mode": "train", "fromCityId": "paris", "toCityId": "london", "amountMinor": 5000, "currency": "EUR" }` through transport-costs. Read budget-summary for separate EGP/EUR totals. Move transport, reorder/delete days, then publish/clone as another traveler and verify independent amounts and fresh IDs.

Tests load real BudgetingModule/ItinerariesModule/AuthModule, guards and disposable local MongoDB. Cases cover source/category arithmetic, mixed currencies, zero values, CRUD, transport movement, ownership/roles, restricted-password sessions, legacy data, public cloning, cascades, overflow, concurrency and Swagger. No `.env`, Atlas or external FX service is used. Follow the README test-binary instructions for `npm run test:e2e`.

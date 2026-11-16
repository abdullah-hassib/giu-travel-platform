# Itinerary budgeting and currency conversion

## Coverage

Implements daily budget CRUD (ITN-14), intercity transport CRUD (ITN-16), original-currency breakdowns and preferred-currency conversion with daily database cache/fallback (ITN-18). It extends day deletion/reordering/grouping and clone coverage under ITN-07/08/09/21. Select preferred currency through the ACC-09 profile endpoint before requesting a converted summary.

## API

| Method | Path | Body / result |
| --- | --- | --- |
| POST | /api/itineraries/:id/days/:dayId/budgets | category, amountMinor, currency; 201 updated itinerary |
| PATCH | /api/budgets/:id | Optional category/amountMinor/currency; 200 updated itinerary |
| DELETE | /api/budgets/:id | 200 updated itinerary |
| POST | /api/itineraries/:id/transport-costs | dayId, mode, fromCityId, toCityId, amountMinor, currency; 201 updated itinerary |
| PATCH | /api/transport-costs/:id | Optional creation fields, including an owned destination dayId; 200 updated itinerary |
| DELETE | /api/transport-costs/:id | 200 updated itinerary |
| GET | /api/itineraries/:id/budget-summary | Native totals plus converted category/day totals when preferred currency is set; 200 |

All routes require active traveler-role access and parent ownership. Guests receive 401, staff-only/restricted-password sessions 403, and foreign/missing resources 404. DTOs reject unknown fields, malformed IDs, negative/fractional/unsafe amounts and unsupported currencies/categories/cities. Required fields cannot be null. Responses use no-store and documented Swagger schemas. Concurrent edits return 409; reload/retry.

Categories are `food`, `accommodation`, `in_city_transport` and `activities`. Amounts are non-negative integer minor units, including zero, using currency codes from the official-country snapshot. Transport mode is trimmed nonempty text; endpoints must be official cities, and dayId must belong to this itinerary. The workbook supplies no additional mode enumeration or country restriction for transport endpoints, so none is invented here.

The summary uses the authenticated owner's saved preferred currency and accepts no query fields. Unsupported overrides such as `?currency=USD` return 400. Profiles with no preferred currency retain the native summary response. Selecting currency adds a `converted` object to that same response. A missing usable rate returns 503 for the converted-summary request; native amounts remain readable through the itinerary view.

## Consistency and totals

Entries are embedded under their assigned day and reuse the existing itinerary optimistic save/ownership path. Moving transport preserves its entry ID and changes the containing day. Day references/dates/numbers derive from containment. Deleting a day atomically removes its budget, transport and activities. Reordering/start-date changes update all breakdowns.

`budgetSummary.totalByCurrency` contains complete native totals. `byCategory` has the four budget categories plus `intercity_transport`; explicit Activities entries and activity costs both count under Activities. `byDay` includes day ID/number/date and the same breakdown. `cityGroups[].budgetTotals` includes all consecutive-day costs. Existing `activityTotals` remains activity-only for compatibility.

Currencies stay separate. Safe-integer checks apply across combined cost sources and reject overflow before persistence. No derived total is stored. Public views include the original-currency budgets/summary. Clones receive fresh budget/transport/day IDs and point transport at the cloned days. Source and clone remain independent. Older records missing the new arrays are interpreted as empty.

## Demo and verification

### Preferred currency and daily rates

Set `{ "preferredCurrency": "EUR" }` through `PATCH /api/users/me`, then GET the itinerary budget-summary. The additive `converted` object includes `currency`, `totalMinor`, `byCategory`, `byDay`, `rateDate`, `fetchedAt`, `source`, `fallback` and `stale`. The rate date comes from the provider. `fallback` indicates that a previous successful cache was used after today's fetch failed or remained incomplete. `stale` indicates a rate date before the current UTC date, including older rates returned by a successful API request.

Rates use USD as their common base. One successful snapshot is saved per UTC day in `itinerary_fx_rates`, shared across all itineraries, currencies and server processes. A unique day ID and conditional attempt ID coordinate concurrent fetches. Network requests time out after five seconds and reject redirects. Concurrent readers wait at most about six seconds for the current fetch. Failed or interrupted attempts can be retried by a later request after a one-minute backoff, with one retry owner. Superseded attempts cannot overwrite a recovered snapshot. These timeout/backoff durations are implementation choices. API failure uses the most recent successful persisted snapshot. An empty cache plus failure returns a sanitized 503. Successful rates persist across process restarts.

The fixed server-side endpoint is `https://api.fxratesapi.com/latest`, using daily rates for the seven supported currencies. Public daily access was verified without a key on November 16. An optional private `FXRATES_API_KEY` increases authenticated quota when configured. The API key is kept in the outbound server request and omitted from persisted data, public responses and errors. Response validation requires a successful USD response, a valid non-future rate date and positive finite rates for every supported currency. The request/response adapter follows the [official FXRatesAPI endpoint documentation](https://fxratesapi.com/docs/endpoints/latest-exchange-rates).

Conversion uses original minor-unit amounts and decimal rate ratios. JPY uses zero decimals, and the other supported currencies use two. Each day/category/source-currency subtotal is rounded half up to the target's minor unit, then summed. Category totals, daily totals and the overall total therefore reconcile, including half-minor-unit cases. Integer fraction arithmetic protects safe-integer boundaries. Unsafe individual or combined converted totals return 400. Stored amounts retain their original currency, and conversion is derived on each summary read. Editing, reordering or deleting costs/days updates the converted result with the same day's cached rates. Flight/hotel payment amounts are outside this conversion path.

As a traveler, add `{ "category": "food", "amountMinor": 10000, "currency": "EGP" }` to a Cairo day. Add an activity cost and `{ "dayId": "<existing-day-id>", "mode": "train", "fromCityId": "paris", "toCityId": "london", "amountMinor": 5000, "currency": "EUR" }` through transport-costs. Read budget-summary for separate EGP/EUR totals. Move transport, reorder/delete days, then publish/clone as another traveler and verify independent amounts and fresh IDs.

Tests load real BudgetingModule/ItinerariesModule/AuthModule, guards and disposable local MongoDB. Cases cover source/category arithmetic, mixed currencies, zero values, CRUD, transport movement, ownership/roles, restricted-password sessions, legacy data, public cloning, cascades, overflow, concurrency and Swagger. FX e2e tests replace only the external provider with deterministic fixtures. Client unit tests validate request construction, response rejection and safe failures. A separate live smoke check exercised the production public client, persisted one snapshot in a disposable database, reused it without a second API request and converted an amount safely. It reported all seven currencies and a rate date of November 15. No private configuration or shared Atlas data was accessed. Follow the README test-binary instructions for `npm run test:e2e`.

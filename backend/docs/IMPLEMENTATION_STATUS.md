# November 14, 2026 — Implementation status

## November 15 original-currency budgeting slice

- Added seven budget/transport/summary operations with traveler/owner guards, DTO validation, Swagger and no-store responses. Daily categories, activity costs and intercity costs are included in native currency totals by day/category and city group.
- Embedded entries share the itinerary's optimistic save. Transport can move between owned days with a stable ID; deletion/reordering and cloning preserve valid ownership/day references, recalculate totals and copy all budget/transport content independently.
- Missing legacy monetary arrays are treated as empty. Combined-source overflow, invalid/null amounts and unsupported conversion queries are rejected before persistence. No currencies are mixed or invented rates returned.
- Added 28 real HTTP/MongoDB regression cases. FX conversion/cache/fallback and preferred currency remain pending under ITN-18; the user confirmed no FX key is configured. Media/provider integration and administration PR #9 remain deferred. See BUDGETING.md for contracts and demo steps.

## November 15 itinerary-core slice

- Implemented owner-managed private itinerary CRUD, ordered days (60 maximum), activity CRUD with optional time/cost, derived calendar dates and consecutive city groups, public visibility/search/read, and independent private cloning of current content with attribution.
- Fifteen REST operations use DTO validation, owner/role guards, no-store responses and documented Swagger schemas. Public author lookup hides deactivated authors and preserves suspended-author content.
- Itinerary-only read-only country/city/currency validation uses exact records from the official workbook. Reference database seeding/APIs remain Kuwaity's work and are not claimed implemented here. See ITINERARIES.md for source provenance and boundaries.
- Optimistic concurrency, complete day permutations and safe-integer totals prevent silent overwrites, cap races and monetary precision loss. Dates and activity subtotals are derived after every edit.
- ITN-01/03/05/10/20 core behaviors are implemented; ITN-07/08/09 and ITN-21 still need full budget/media coverage in subsequent slices. Budget CRUD/transport/FX, media, and flight/hotel integrations remain pending. The administration status feature remains deferred in draft PR #9.

## November 15 admin-assisted password-reset slice (ACC-07a, ACC-08)

- Added POST /api/admin/users/:id/reset-password with admin role checks, validated ObjectIds/passwords, forbidden administrator targets and no secret response body. Inactive target status is preserved.
- Password replacement, session invalidation/deletion, lockout reset and a sanitized administrative outbox event commit in one transaction. The producer is complete; Omar's audit/notification consumer remains an integration dependency and pending events are not claimed delivered.
- Temporary-password login exposes mustChangePassword. SessionGuard permits only identity and password-change routes during the restricted workflow; refresh and logout remain usable. Changing to the same temporary password is rejected. Successful change clears the flag, invalidates sessions and requires re-login.
- Admin HTTP tests now use an isolated replica set to verify transactions and rollback on outbox failure. No shared Atlas data or credentials are accessed. Live Atlas/HTTPS checks remain pending.

## November 15 administrator account-list slice (ACC-14, GEN-05)

- Added GET /api/admin/accounts through AdministrationModule using the existing User model, SessionGuard and RolesGuard. The endpoint supports literal case-insensitive name/email search and combined role/status filters, ten-row pages, stable newest-first ordering, sanitized rows and no-store responses.
- Response projection excludes password hashes, session versions, lockout state and consent metadata. MongoDB aggregation facets generate rows and totals from the same input stream. Legacy missing registration timestamps are null.
- Real HTTP/MongoDB tests load the actual AdministrationModule/AuthModule and guards, including guest/non-admin denial, inactive administrator denial, pagination, projection, filtering, regex escaping, invalid/operator query rejection and Swagger generation.
- Account status changes, admin-assisted reset and moderator creation remain unimplemented. The next write slice requires an agreed durable audit/notification handoff with Omar. The read-only list emits no placeholder events.

## November 15 access/refresh authentication slice

- User-approved design implemented for ACC-06/ACC-19: separate access/refresh HttpOnly cookies, five-minute access expiry, atomic rotation, replay-family revocation, refresh-only logout and clearing both cookies on logout/password change/deactivation. Swagger describes the new endpoint, both cookie schemes and sanitized response schemas.
- Existing absolute and thirty-minute idle limits apply to refresh. Refresh is denied for inactive accounts and stale session versions. Legacy single-cookie records remain bounded by their existing limits until re-login.
- Real isolated-MongoDB tests now cover rotation, consumed-token replay, concurrent refresh, expiry, logout, account status/version denial and the real HTTP cookie flow. Production Secure/HttpOnly/SameSite cookie flags are checked in HTTP tests. Live Atlas and HTTPS browser verification remain pending. See API_CONVENTIONS.md for the frontend refresh coordination and transition rules.
- Authentication flow implementation is covered by available tests. Admin-assisted password reset, mandatory first-login changes, profile currency/phone and booking/content dependencies remain separate incomplete account requirements.

## November 15 idle-expiry slice (ACC-06)

- Authenticated requests renew `lastAuthenticatedAt` atomically only while the session is still unexpired and present. Thirty minutes of inactivity requires a new login, independently of the TTL background cleanup schedule. The existing absolute lifetime remains enforced.
- Legacy session records fall back to their persisted update/creation timestamps. Concurrent requests use `$max` so activity cannot move backwards. Suspended accounts, stale session versions and sessions revoked between lookup and renewal are rejected.
- Added real isolated-MongoDB regression tests for idle/absolute expiry, renewal, legacy sessions, revocation races, password invalidation, and the prior atomic lockout behavior. The harness owns a disposable database and does not use Atlas or `.env`.
- The refresh-token portion was implemented in the subsequent access/refresh slice described above.

## November 15 authentication update

- The official requirements workbook linked from `docs/GIU_Travel_Implementation_Checklist.md` is now readable through Drive. ACC-01, ACC-04, ACC-05 and ACC-08 were checked against its text for this slice. Earlier missing-workbook statements below describe the November 14 snapshot.
- Registration requires `termsAccepted: true` and records a server-side `termsAcceptedAt` timestamp for new travelers. Existing accounts are not assigned a retroactive consent timestamp.
- Registration and replacement passwords require at least eight characters, a letter and a digit. The existing 128-character maximum remains an implementation limit.
- Failed-attempt counting, expiry-window reset and lock creation use a single conditional MongoDB update pipeline. A successful login cannot reset an active lock or a changed password/account. ACC-05 configuration permits exactly five attempts and fifteen minutes.
- Suspended accounts receive an account-suspended response. Existing accounts can still log in using their original passwords, including passwords created before the stronger registration rules.
- Session versioning from the previous slice rejects stale sessions after password changes or deactivation.
- Still pending in authentication/accounts: access/refresh-cookie requirements, admin-assisted reset and first-login password change, phone/preferred currency, and booking/content integration for account deactivation. This slice does not complete ACC-06, ACC-09, ACC-11, ACC-12 or ACC-19.
- Service regression tests mock database operations. Live MongoDB concurrency verification remains pending.

## Source of truth
- Official 14-page GIU Software Project I Winter 2026 PDF is available in the user chat. Relevant sections: roles (p. 2), accounts (pp. 3–4), required API endpoints (pp. 6–10), Milestone 1 deadline November 20 (p. 6), Git and AI usage (pp. 11–13).
- The separate **Excel requirements workbook remains missing**. It specifies exact validation, password rules, lockout duration, session expiry, policies, caps, and acceptance criteria.
- Required **Countries.csv, Cities.csv, Airports.csv, Attractions.csv** remain missing. No fake seed data was introduced.

## Functional endpoints implemented (source code; execution not yet verified)
| Method | Path | PDF references | Notes |
|---|---|---|---|
| POST | /api/auth/register | ACC-01 | Always registers a traveler; email unique index |
| POST | /api/auth/login | ACC-04, ACC-05 | Hashed Mongo session token in HttpOnly cookie, lockout defaults provisional |
| POST | /api/auth/logout | ACC-06 | Session revocation; idempotent |
| PATCH | /api/auth/change-password | ACC-08 | Verifies current password and revokes sessions |
| GET | /api/auth/me | ACC-04, ACC-19 | Checks account status and session expiry |
| GET | /api/users/me | ACC-11 | Only own profile |
| PATCH | /api/users/me | ACC-09 | Only fullName until workbook specifies other fields |
| DELETE | /api/users/me | ACC-12 | Soft deactivation, session revocation |
| GET | /api/health/live | extra | Process liveness |
| GET | /api/health/ready | extra | MongoDB readiness |
| GET | /api/docs | deliverable | Swagger UI |

## Supporting functionality
- Mongoose User and UserSession schemas, unique email, TTL session index.
- `npm run seed:admin` (explicit admin bootstrap via environment variables). No administrator self-registration.
- SessionGuard for private endpoints; RolesGuard + @Roles decorator ready for admin/moderator routes. **No moderator/provider ownership checks yet.**
- Global validation, exception filter, configuration validation, pagination/sorting convention.
- Unit tests for password hashing, cookie parsing, auth login, config, health, pagination, exceptions; isolated HTTP tests for health/Swagger and auth routes.

## Not implemented
- All other feature modules (flight/hotel search/booking, holds, inventory, payments/Stripe, refunds, itineraries/budgets/FXRatesAPI, blog/community, notifications, moderation, media, auditing, reference CSV import), full administration, moderator provisioning, account password reset, deeper profile fields.
- Full browser CSRF defense / frontend CORS deployment policy (SameSite=Strict and HttpOnly cookies are initial safeguards, not complete cross-origin architecture).
- Production-grade lockout and password rules awaiting workbook acceptance criteria. Admin bootstrap should be human-reviewed.
- No live integration test or successful build: npm registry DNS failure in build environment; Atlas credentials not provided.

## Human review gates
1. Supply official Excel workbook and datasets; reconcile all acceptance criteria.
2. Confirm account schema, session duration, lockout and password policies.
3. Choose production frontend origin and CSRF protections before browser integration.
4. Supply Atlas connection string privately on developer machine (never into chat or source).
5. Run tests, build, and live Swagger/database verification. Do not merge before green checks.

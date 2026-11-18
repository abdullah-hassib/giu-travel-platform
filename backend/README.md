# GIU Travel Backend — Milestone 1 work in progress

See [root README](../README.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [contracts requiring approval](docs/CONTRACTS_PROPOSED.md).

Current Hassib-owned mandatory coverage and remaining work are tracked in [Milestone 1 backend coverage](docs/M1_BACKEND_COVERAGE.md).

The [November 18 completed-slice handoff](docs/M1_INDEPENDENT_HANDOFF.md) lists merged PRs, exact validation and remaining flight/Omar/Stripe dependencies. Available admin, itinerary image/search and hotel deactivation work is implemented and verified.

## Quick start

```bash
npm install
cp .env.example .env
# Set MONGODB_URI in the new local .env (never commit this file).
npm run typecheck
npm run build
npm run lint
npm test
npm run test:e2e
npm run start:dev
```

Swagger: `http://localhost:3000/api/docs`
Liveness: `http://localhost:3000/api/health/live`
Atlas readiness: `http://localhost:3000/api/health/ready`

Routes implemented in source: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/change-password`, `/api/users/me` (GET, PATCH, DELETE), plus health and Swagger.

The current feature branch adds GEN-01 notification routes (`GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`) and `GET /api/admin/audit-logs` (GEN-07). The notification route names and response shapes are treated as agreed for this branch. Access rules, filters, and event-delivery behavior are documented in [notifications and audit logging](docs/NOTIFICATIONS_AND_AUDIT.md).

`POST /api/auth/refresh` rotates the access and refresh cookies and returns `{ user }`. Login also returns `{ user }` and sets both cookies. Access credentials expire after five minutes. Refresh preserves the existing absolute deadline and thirty-minute idle limit. Clients must serialize refresh requests across tabs; reuse of a consumed refresh credential revokes the family. Logout clears both cookies and revokes the family even when only the refresh cookie remains. Existing single-cookie sessions can continue within their original limits; log in again to acquire refresh capability. See [authentication contract](docs/API_CONVENTIONS.md#approved-authentication-contract-acc-06-acc-19).

Administrators can use `GET /api/admin/accounts?page=1&search=example&role=traveler&status=active` to inspect accounts (ACC-14), ten per page (GEN-05). Log in with a privately seeded administrator first; Swagger uses the access cookie. All query fields are optional, and the response contains registration dates and sanitized profile fields. Travelers and moderators receive 403; guests receive 401. Account status changes remain in deferred draft PR #9; password reset is described below.
Administrators can use `GET /api/admin/accounts?page=1&search=example&role=traveler&status=active` to inspect accounts (ACC-14), ten per page (GEN-05). Log in with a privately seeded administrator first; Swagger uses the access cookie. All query fields are optional, and the response contains registration dates and sanitized profile fields. Travelers and moderators receive 403; guests receive 401. Password reset and this candidate's status commands are separate operations described below.

For ACC-07a, administrators can now call `POST /api/admin/users/:id/reset-password` with `{ password }` for a traveler/moderator. The route requires a transaction-capable replica set. Reset revokes all target sessions and returns 204. Logging in with the temporary password returns `user.mustChangePassword=true`; profile and other protected actions remain blocked. Use PATCH /api/auth/change-password with the temporary current password and a different compliant replacement, then log in again. The pending administrative event is committed atomically with the reset. The current feature branch consumes `account.password_reset` into one audit record in a transaction; other admin, payment, booking, and provider event integrations remain pending team contracts. The admin e2e suite starts its own disposable replica set to verify this flow and rollback.

Registration now requires `termsAccepted: true`. Registration and password changes require at least eight characters with a letter and a digit. Login continues to accept existing credentials. Lockout configuration must use `AUTH_MAX_FAILED_ATTEMPTS=5` and `AUTH_LOCKOUT_MINUTES=15` to match ACC-05.

ACC-06 idle expiry is thirty minutes. Each successfully authenticated request updates server-side activity. Expired, revoked, suspended-account and stale-version sessions cannot renew activity. The existing configured absolute session lifetime still applies. Legacy sessions use their persisted update/creation timestamps until the first successful authenticated request records `lastAuthenticatedAt`.

The persistence e2e suite uses `mongodb-memory-server-core` to create and stop its own disposable local MongoDB. It never loads `.env` or connects to Atlas. Its default setup downloads a test binary when needed. To use an existing local `mongod` instead, set `MONGOMS_SYSTEM_BINARY` to that executable and `MONGOMS_VERSION` to its version before running `npm run test:e2e`. Setting `MONGOMS_RUNTIME_DOWNLOAD=false` prevents downloads. These are test-process settings, independent of application credentials.

In Swagger, register using `fullName`, `email`, a compliant `password` and `termsAccepted: true`. Omitting consent or using a password without a letter/digit returns 400. On a disposable test account, the fifth incorrect login returns 429, and login remains blocked for fifteen minutes. Account lockout uses an atomic MongoDB update pipeline, so MongoDB 4.2 or newer is required. Use isolated service/HTTP tests before human-authorized live database checks.

`npm run seed:admin` bootstraps an administrator from one-time environment variables. Example on a developer machine (replace the email; enter a strong private password at the prompt):

```bash
export ADMIN_BOOTSTRAP_EMAIL='admin@example.com'
read -rsp 'One-time admin password: ' ADMIN_BOOTSTRAP_PASSWORD; echo
export ADMIN_BOOTSTRAP_PASSWORD
npm run seed:admin
unset ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_PASSWORD
```

Never put credentials into Git, AI chats, or the project ZIP. Run only once after MongoDB credentials are configured. The admin identity and exact password policy still require review against the workbook.

## Official reference data

Kuwaity's reference-data slice provides public countries, cities, airports, attractions and currency lookup/search APIs, a reusable ReferenceDataService and the four official CSV exports. Run `npm run seed:reference` for offline integrity validation. Database writes require `--apply` and private process configuration; use the shared database only after the required team approval. See [reference API, seed commands and team handoff](docs/REFERENCE_DATA.md). Until this edition is seeded, reference lookups return 503. Existing user/itinerary/FX validation retains the same source identifiers through the shared snapshot.
## Administration services

Merged administration includes account listing/reset/status, real hotel moderator assignment/password enforcement, required hotel provider commands, an explicit hotel booking list and retained committed action history. Account status/session/event mutations are transactional. Hotel adapters are concrete; compatible airline adapters and Omar delivery remain pending. See [administration routes and handoff](docs/ADMINISTRATION.md), [hotel booking reads](docs/ADMIN_BOOKINGS.md) and [action history](docs/ADMIN_AUDIT_HISTORY.md).

## Hotels, bookings, reviews, blog and moderation

Hotel inventory, search, concurrency-safe bookings, reviews, the blog, content reports and admin moderation are described in [docs/HOTELS_AND_COMMUNITY.md](docs/HOTELS_AND_COMMUNITY.md), with a Swagger demo order and the integration handoffs for payments, administration and notifications. Uploaded JPG/PNG images are stored in `MEDIA_UPLOAD_DIR` (default `./uploads`, ignored by Git) and served from `/api/media/:imageId`.

## Important

Policy review/acceptance and payment/refund services are connected to MK's real hotel booking adapter. Both concrete hotel and flight settlement adapters are connected; see [flight integration](docs/FLIGHT_PAYMENT_INTEGRATION.md). See [policy contract](docs/PAYMENT_POLICIES.md) and [hotel integration](docs/HOTEL_PAYMENT_INTEGRATION.md).

USD is the platform currency. Payment create/retry/status, signed raw webhooks, durable event recovery, expiry and policy-derived cancellation/late refunds are implemented with actual hotel transactions. Private live Stripe test verification, private live Stripe verification remains pending. Flight holds, settlement and saved-policy refunds are connected; required flight search/operations/exports are subsequent slices. Account, hotel/provider/moderation and refund events now feed Omar's notification/audit consumers; see [delivery integration](docs/NOTIFICATIONS_AND_AUDIT.md). See [settlement API and demo](docs/PAYMENT_SETTLEMENT.md) and [private gateway setup](docs/STRIPE_GATEWAY.md).

ACC-09 profile editing supports name, international phone and the official supported preferred currencies through `PATCH /api/users/me`. All fields validate before an atomic save. Existing accounts return null phone/currency until set. See [profile inputs and Swagger demo](docs/API_CONVENTIONS.md#own-profile-acc-09).

Budget and intercity transport CRUD include native day/category/group totals and preferred-currency summary conversion with daily database rates and fallback. Public daily FXRatesAPI access has been verified without a key. An optional private `FXRATES_API_KEY` can be configured for authenticated quota. See [budgeting API contract and demo](docs/BUDGETING.md).

Itineraries support private CRUD, ordered days/activities, public discovery, budgets/FX, owned city-group hotel search and activity images with private/public access and independent clone files. Flight search remains pending. See [itinerary API/demo](docs/ITINERARIES.md), [hotel search](docs/ITINERARY_HOTEL_SEARCH.md) and [images](docs/ACTIVITY_IMAGES.md). [Self-deactivation](docs/ACCOUNT_DEACTIVATION.md) atomically revokes sessions, blocks upcoming Confirmed hotel stays and protects against payment races; current/upcoming flight segments are included in the same transactional guard.

The official workbook and reference CSVs have been inspected. Typecheck/build/lint, 209 unit and 554 HTTP/database tests passed, including complete AppModule/Swagger/auth/admin smoke with validated disposable configuration and no .env loading. Production cookie flags are tested; local HTTP uses non-Secure cookies. Live Stripe, shared Atlas payment transactions and HTTPS/browser demonstration remain unverified; shared reference seeding was separately verified. See the current handoff for cross-team dependencies and documented cleanup/retention limits.

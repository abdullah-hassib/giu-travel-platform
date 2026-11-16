# GIU Travel Backend — Milestone 1 work in progress

See [root README](../README.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [contracts requiring approval](docs/CONTRACTS_PROPOSED.md).

Current Hassib-owned mandatory coverage and remaining work are tracked in [Milestone 1 backend coverage](docs/M1_BACKEND_COVERAGE.md).

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

`POST /api/auth/refresh` rotates the access and refresh cookies and returns `{ user }`. Login also returns `{ user }` and sets both cookies. Access credentials expire after five minutes. Refresh preserves the existing absolute deadline and thirty-minute idle limit. Clients must serialize refresh requests across tabs; reuse of a consumed refresh credential revokes the family. Logout clears both cookies and revokes the family even when only the refresh cookie remains. Existing single-cookie sessions can continue within their original limits; log in again to acquire refresh capability. See [authentication contract](docs/API_CONVENTIONS.md#approved-authentication-contract-acc-06-acc-19).

Administrators can use `GET /api/admin/accounts?page=1&search=example&role=traveler&status=active` to inspect accounts (ACC-14), ten per page (GEN-05). Log in with a privately seeded administrator first; Swagger uses the access cookie. All query fields are optional, and the response contains registration dates and sanitized profile fields. Travelers and moderators receive 403; guests receive 401. This read-only endpoint does not yet implement account status changes or password reset.

For ACC-07a, administrators can now call `POST /api/admin/users/:id/reset-password` with `{ password }` for a traveler/moderator. The route requires a transaction-capable replica set. Reset revokes all target sessions and returns 204. Logging in with the temporary password returns `user.mustChangePassword=true`; profile and other protected actions remain blocked. Use PATCH /api/auth/change-password with the temporary current password and a different compliant replacement, then log in again. The pending administrative event is committed atomically with the reset; Omar's consumer is still to be integrated. The admin e2e suite starts its own disposable replica set to verify this flow and rollback.

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

## Important

ACC-09 profile editing supports name, international phone and the official supported preferred currencies through `PATCH /api/users/me`. All fields validate before an atomic save. Existing accounts return null phone/currency until set. See [profile inputs and Swagger demo](docs/API_CONVENTIONS.md#own-profile-acc-09).

Budget and intercity transport CRUD include native day/category/group totals and preferred-currency summary conversion with daily database rates and fallback. Public daily FXRatesAPI access has been verified without a key. An optional private `FXRATES_API_KEY` can be configured for authenticated quota. See [budgeting API contract and demo](docs/BUDGETING.md).

The itinerary core now supports private CRUD, ordered days/activities, public discovery and private cloning. See [itinerary API contract and demo](docs/ITINERARIES.md) for requests, reference provenance, ownership, concurrency and remaining budgeting/media integration work.

The official workbook is readable through its linked Drive file. Authentication has been checked with compilation, lint, unit tests, HTTP tests and an isolated real MongoDB process. Production cookie flags are tested; local HTTP development uses non-Secure cookies. Live Atlas and HTTPS browser verification remain pending. Other required features remain incomplete, and reference data/integration contracts still need coordination. See the dated implementation status for requirement coverage and remaining work.

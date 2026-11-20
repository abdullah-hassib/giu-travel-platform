# GIU Travel Backend - Milestone 1

Backend deadline: November 20, 2026. The mandatory backend and the approved HTL-26 review-reply bonus are implemented. The Next.js frontend belongs to Milestone 2, due December 11, 2026.

Start with the [submission checklist](docs/M1_SUBMISSION_CHECKLIST.md), [verified handoff](docs/M1_BACKEND_HANDOFF.md), [requirement review](docs/M1_REQUIREMENT_REVIEW.md) and [AI assistance log](../AI_PROMPTS.txt). The official PDF and Excel workbook define requirements. Earlier dated feature checkpoints remain historical.

## Runtime prerequisites

- Node.js 24 LTS, matching the root `.nvmrc` and GitHub CI. Local verification used Node 24.21.0.
- MongoDB Atlas or another transaction-capable replica set for the application.
- Stripe test credentials and Stripe CLI for payment demonstrations.
- A compatible local `mongod` executable for offline HTTP/database tests, or permission for mongodb-memory-server to download its test binary. Local tests used MongoDB 8.2.7.

## Install and configure

From the repository root:

```powershell
cd backend
npm.cmd ci
```

For a fresh clone only, create `.env` if it does not already exist:

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Configure `MONGODB_URI` privately. Keep Atlas active and permit the development machine's current IP in Atlas Network Access. Preserve existing private configuration. The source archive contains the placeholder `.env.example`; it excludes `.env` and credentials.

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` privately for test-mode payments. The webhook secret must match the CLI listener and sandbox. Missing Stripe configuration returns a safe service-unavailable error when a payment operation is attempted. USD is the fixed flight/hotel/payment/refund currency. Budget display supports the official preferred currencies independently.

`SESSION_TTL_HOURS` defaults to 24 hours. Authentication uses opaque HttpOnly access/refresh cookies, a five-minute access lifetime and thirty-minute inactivity expiry. ACC-05 requires `AUTH_MAX_FAILED_ATTEMPTS=5` and `AUTH_LOCKOUT_MINUTES=15`.

## Start the application

From `backend/`:

```powershell
npm.cmd run start:dev
```

For a built application, run `npm.cmd run build` followed by `npm.cmd run start:prod`.

- Swagger: http://localhost:3000/api/docs
- Liveness: http://localhost:3000/api/health/live
- Database readiness: http://localhost:3000/api/health/ready

For payment demonstrations, keep another terminal running:

```powershell
stripe listen --all-snapshot --forward-to http://localhost:3000/api/payments/webhook
```

Keep any displayed signing secret private and ensure its value matches local configuration. Restart the backend after changing environment configuration. Genuine Stripe acceptance results are recorded in [STRIPE_SANDBOX_ACCEPTANCE.md](docs/STRIPE_SANDBOX_ACCEPTANCE.md).

## Initial accounts and reference data

Administrators are seeded; public registration cannot create an administrator. On a new, approved database, provide `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` privately as one-time process environment variables and run `npm.cmd run seed:admin`. The bootstrap script requires at least 12 password characters; choose a password with a letter and digit as well. Clear the one-time variables afterward. Never include account credentials in Git, a submission archive or the prompt log.

Official reference data and seed instructions are in [REFERENCE_DATA.md](docs/REFERENCE_DATA.md). `npm.cmd run seed:reference` validates the four committed official CSVs without connecting to a database. Applying a seed requires `--apply` and privately configured process environment; use the designated shared database only with team approval. The approved shared seed was already verified and is not repeated by tests or CI.

Register travelers with `fullName`, `email`, a password of at least eight characters including a letter and digit, and `termsAccepted: true`. Administrators create providers and provision their moderators. A moderator manages exactly one assigned hotel or airline and must change the temporary password before protected management actions.

## API and demonstration order

Swagger covers all 110 mandatory PDF method/path operations, supporting routes and the optional HTL-26 reply operation. Protected routes use the login cookie and enforce account status, role, provider assignment and ownership on the server.

1. Log in as an administrator; inspect accounts and provision a provider/moderator.
2. Change the moderator's temporary password, log in again and manage inventory/policies.
3. Register/log in as a traveler; search flights or hotels and create a booking hold.
4. Review and accept the saved policies, create a Stripe test payment and complete it with Stripe's test facilities. Genuine signed settlement confirms the booking.
5. Inspect the booking, flight PDF ticket, cancellation/refund, notifications and administration history.
6. Demonstrate private/public itineraries, cloning, activities/images, budgets/FX and provider search reuse.
7. Demonstrate blog/community content and moderation. For the approved bonus, an assigned hotel moderator can POST a comment to `/api/reviews/:id/reply`; public review listings include the response, and duplicate replies return 409.

Private endpoints use sanitized projections. Flight PDFs, CSV exports and moderator access are covered by dedicated tests. Production cookies use Secure; local HTTP demonstrations use non-Secure cookies. Frontend/browser presentation is part of the later milestone.

## Verification

From `backend/`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run seed:reference
npm.cmd run test:e2e
```

To use this machine's installed test database binary, set these non-secret test-process options before the e2e command:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe'
$env:MONGOMS_VERSION='8.2.7'
$env:MONGOMS_RUNTIME_DOWNLOAD='false'
```

The latest completed local run passed typecheck/build/lint, 209 unit tests in 18 suites and 660 HTTP/database cases in 27 suites. This includes 13 new hotel-reply cases and actual full-AppModule Swagger/health/auth checks. Standard tests use disposable databases and controlled external gateway responses; they load no private `.env` and write no shared Atlas fixtures. Separately approved genuine Stripe tests verified payments, signed webhooks, decline/retry, full refunds and unpaid expiry; both successful payments were fully refunded and both unpaid intents cancelled.

[Backend CI](../.github/workflows/backend-ci.yml) repeats locked installation, source checks, unit tests, offline reference validation and the complete HTTP/database suite on Node 24/Ubuntu 22.04. Check the [actual Actions result](https://github.com/abdullah-hassib/giu-travel-platform/actions/workflows/backend-ci.yml) and final submission manifest for the tested commit/run. It uses no private credentials or shared database.

Feature contracts and known limits are linked from the current handoff. No new runtime credentials, reference seed, payment or optional feature is needed to prepare the source submission.

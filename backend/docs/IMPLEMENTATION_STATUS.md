# November 14, 2026 — Implementation status

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

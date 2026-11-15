# Proposed API conventions (review before feature work)

- Base path: `/api`; REST JSON with resource-based paths. Swagger UI: `/api/docs`; OpenAPI JSON: `/api/docs-json`.
- Requests: DTOs validated globally with `whitelist`, `forbidNonWhitelisted`, `transform`. Use explicit DTO decorators for every accepted field.
- Error shape: `{ statusCode, error, message, path, timestamp }`; validation `message` may be a list. Unhandled failures return generic 500 text, no stack traces or secrets.
- Pagination: `page` (1-indexed, default 1), `limit` (default 20, maximum 100). Response `{ data: [], meta: { page, limit, total, totalPages } }`.
- Sorting: `sortBy` (single field name) and `order` (`asc`/`desc`). **Every endpoint must allowlist its valid sort fields**; regex in shared DTO is not a database field allowlist.
- Filtering: only explicit DTO query fields per endpoint; disallow arbitrary MongoDB query operators. Normalize search terms and date ranges per feature.
- Date/time: UTC ISO-8601 timestamps; store travel dates/times with location/timezone context if mandated by spec.
- IDs: ObjectId strings at HTTP boundaries. Responses and endpoint nomenclature are not yet finalized.
- Auth: a MongoDB-backed opaque session token is stored only as a SHA-256 hash, with an `HttpOnly` `SameSite=Strict` browser cookie (`Secure` under production HTTPS). Swagger defines cookie authentication, not bearer authentication. `/api/auth/me` and `/api/users/me` require SessionGuard. RolesGuard exists for future administrative/provider routes, which must also enforce ownership.
- Health: `GET /api/health/live` and `GET /api/health/ready` (`503` until database connection is healthy).

## Administrator account listing (ACC-14, GEN-05)

`GET /api/admin/accounts` requires an active administrator session. Guests receive 401; authenticated travelers and either moderator role receive 403. Responses use `Cache-Control: no-store`.

Supported query fields are `page` (positive integer, default 1), `search` (trimmed case-insensitive literal substring of name or email), `role` (one of the existing role codes) and `status` (`active`, `suspended`, `deactivated`). Filters combine with AND; name/email search matches either field. Regex characters are treated literally. Unsupported fields, including arbitrary sorting and limit overrides, return 400.

The response uses `{ data, meta: { page, limit, total, totalPages } }`, with fixed page size 10 as mandated by GEN-05. Results sort by registration timestamp descending, then ObjectId descending for stable ties. Each row contains only `id`, `fullName`, `email`, `roles`, `status` and `createdAt`. Unknown legacy registration timestamps are null. Empty matches have totalPages 0; pages beyond the end return an empty data array with the actual totals.

This endpoint uses its own pagination validation. The shared PageQueryDto/default-20 convention above remains an older proposal awaiting cross-team reconciliation; this slice does not alter teammate consumers.

## Approved authentication contract (ACC-06, ACC-19)

The user approved the access/refresh design on November 15. It applies to all protected feature routes using SessionGuard.

- Login sets `giu_session` (five-minute access credential) and `giu_refresh` (refresh credential). Both use HttpOnly, SameSite=Strict and path `/api`. Secure is enabled in production and on direct HTTPS requests. Local HTTP development uses non-Secure cookies; evaluation of HTTPS browser behavior remains required.
- `POST /api/auth/login` and `POST /api/auth/refresh` return `{ user }`. `GET /api/auth/me` returns the sanitized user directly. Token values occur only in Set-Cookie headers and are never returned in response JSON. Login, refresh and identity responses use `Cache-Control: no-store`.
- `POST /api/auth/refresh` takes its credential exclusively from the refresh cookie. It rotates both credentials atomically, preserving the original absolute deadline. Five minutes is the chosen access-token implementation lifetime. The existing `SESSION_TTL_HOURS` controls the absolute deadline (default 24 hours), and thirty minutes without authenticated activity expires the family.
- The refresh credential contains a random family secret and a random rotating secret. MongoDB stores their family hash and complete-token hash. Knowledge of a consumed family credential permits family revocation but cannot mint a new credential. Rotation needs no growing token-history array.
- Reusing a consumed refresh credential revokes that session family. Concurrent refresh calls have at most one winner and invalidate the family. Frontends must serialize refresh across tabs, queue protected requests during rotation and avoid blind refresh retries after a lost response. After a refresh 401, require login. A protected-route 401 may initiate one serialized refresh and one request retry. A 403 does not initiate refresh.
- Logout works with either cookie, including an expired access credential and an available refresh cookie. It revokes the family and clears both cookies. Password changes revoke all families through session versioning and cleanup. Inactive accounts cannot authenticate or refresh. Deactivation clears both cookies and invalidates the account sessions.
- A refresh 401 clears both cookies. Database failures propagate safely without clearing a potentially usable cookie, permitting recovery. Refresh cannot revive an expired/revoked family or cross an account-version change.
- Legacy single-cookie records retain their original absolute and idle limits, and have no refresh capability. Re-login upgrades them to the new format. The optional schema fields and sparse unique family index permit existing documents to remain usable during this transition.
- Protected routes continue to use SessionGuard and `giu_session`; teammates do not need to implement token parsing. Ownership and RolesGuard requirements still apply independently.

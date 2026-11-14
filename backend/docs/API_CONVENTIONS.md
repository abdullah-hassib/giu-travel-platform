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

# Shared contracts — PROPOSED / NOT APPROVED

These definitions are *discussion artifacts*. The uploaded official GIU PDF has been reviewed; they still must be reconciled with the missing Excel requirements workbook and approved by the four human developers before implementations depend on them.

## Identity and authorization
- `UserId`, `ProviderId`, `EntityId`: strings representing MongoDB ObjectIds (24-character hex). Validate at inbound boundaries; avoid accidental mixing in services (branded types may follow).
- **PDF-confirmed role categories**: registered traveler, administrator, airline moderator, hotel moderator (plus unauthenticated guest and automated system services). TypeScript naming proposed: `traveler`, `admin`, `airline_moderator`, `hotel_moderator`. There is no generic `provider` account role in the PDF. Confirm exact code names and multi-role access in the workbook.
- Authorization contract: `AuthorizationPolicy.canAccess(ResourceAccessContext)`; default-deny must be enforced when concrete guards are added. SessionGuard protects implemented user endpoints; RolesGuard exists but is not yet deployed for administration or provider ownership. **Do not expose other protected routes without complete guards and ownership policies.**
- Moderator-to-provider assignment: moderatorId, providerType (`airline` or `hotel`), providerId, assignedAt, assignedBy, active. **PDF requires exactly one assigned airline/hotel** for each moderator. Enforce one active assignment, correct provider type and ownership; revocation details require workbook/team approval.

## Booking lifecycle
- Candidate common states for **flight and hotel**: `pending → confirmed → completed`, `pending/confirmed → cancelled`. Real transitions, expiry and no-show states need specification confirmation; do not conflate reservation and ticket issuance.
- Require state-transition validation and idempotency; never update inventory, payment, and booking as independent uncoordinated operations.

## Payments and refunds
- Payment candidate states: `pending → authorized → captured`; `pending/authorized → failed`; `captured → partially_refunded / refunded`. Confirm gateway semantics and captured-without-authorization cases.
- Refund candidate states: `requested → approved → processing → completed`, rejection/failure branches. Confirm whether refunds may be auto-triggered.
- Amounts are **integer minor units** (`amountMinor`) plus ISO 4217 `currency`. Determine rounding and currency rules with team.
- `BookingPaymentRequest`: bookingId, kind, userId, amountMinor, currency, idempotencyKey. `PaymentBookingResult`: bookingId, paymentId, state, correlationId. API payment initiation, webhooks, replays, compensation and handling failed payments are deliberately deferred.

## Events, notifications and audit
- Proposed `DomainEvent`: `id`, `type`, `version`, `occurredAt`, `correlationId`, optional `actorId`, payload. `EventPublisher` is an interface only; no broker/outbox decision yet.
- Proposed notification event types: booking.confirmed, booking.cancelled, payment.captured, payment.failed, refund.completed. Confirm required channels, templates, trigger conditions and retries.
- Proposed audit record: actorId, action, entityType, entityId, timestamp, correlationId, outcome, sanitized metadata. Avoid credentials, tokens, payment card data, and personal data in logs.
- Choose in-process events vs persisted outbox before relying on delivery; for critical payment state transitions prefer persisted outbox / transaction strategy.

## Open questions / approval gates
1. Confirm all statuses and allowed transitions separately for flight and hotel bookings.
2. Confirm exact roles, provider ownership and moderator assignment semantics.
3. Confirm payment provider, currencies, gateway callback verification and refund policies.
4. Confirm events, delivery guarantees, audit retention, sensitive fields, and who can read audit logs.
5. Confirm pagination/filter conventions and requirements workbook field names before exposing endpoints.
6. Confirm whether booking capacities/seat holds and hotel date overlaps require locking or reservation expiry.

Types are in `src/common/auth/authorization.contract.ts` and `src/common/contracts/domain-events.contract.ts`. Authentication and Users use live Mongo schemas and guards. Booking/payment/notification cross-module types remain proposed and unconsumed.

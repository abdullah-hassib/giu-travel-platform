> Current integration note (November 18): this file contains historical proposals. Approved payment/provider documents and actual merged modules take precedence. Omar PR #36 is reconciled on the integration branch: account, hotel/provider/moderation and refund envelopes now feed his services without producer schema changes. The canonical audit route retains its existing ten-row contract and durable archive fallback. See NOTIFICATIONS_AND_AUDIT.md. Flight producers remain pending.

# Shared contracts — PROPOSED / NOT APPROVED

These definitions are *discussion artifacts*. The official GIU PDF and mandatory requirements CSV are available; event names and payloads still need agreement from the owning developers before cross-module producers depend on them.

## November 18 approval update

Hassib approved the administration provider/assignment/outbox plan in ADMINISTRATION_INTEGRATION_PLAN.md before implementation. The candidate implements the moderator/status producer boundary documented in ADMINISTRATION.md. This approval does not approve the older booking/payment proposals below or actual team adapters/consumers on their owners' behalf. Those historical sections are not runtime contracts. The official workbook is now available and was checked for ACC-13/15/16/17. Account routes are exposed only in this draft candidate, with concrete provider and audit/notification integration still pending.

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
- `DomainEvent` now has a typed event-name union and notification/audit effect payloads. `DOMAIN_EVENT_PUBLISHER` resolves to a MongoDB outbox publisher. Producers can pass their transaction session; the consumer applies notification and audit effects and marks the event delivered in one transaction. Event names and payloads remain proposals until their owning feature developers agree.
- Notification event names include booking confirmation/cancellation, flight schedule changes/cancellations, refund status changes, account suspension, provider deactivation, plus the existing payment/refund candidates. Confirm exact trigger conditions, recipient selection, message templates, and owner-specific payload fields.
- Proposed audit record: actorId, action, entityType, entityId, timestamp, correlationId, outcome, sanitized metadata. Avoid credentials, tokens, payment card data, and personal data in logs.
- The durable MongoDB outbox is the implemented handoff for the current feature branch. Agree on transaction participation, event retention, retry monitoring, and any dead-letter policy before production use.

## Open questions / approval gates

### Existing administration event producer and Omar consumer

Current producer implementation: ACC-07a writes `account.password_reset` into the `admin_outbox` collection in the same transaction as the reset/session deletion. It uses UUID id/correlationId, type, version 1, ISO occurredAt, actorId, payload.targetUserId and status pending. Omar's feature branch now consumes this event into one audit record and marks it delivered in the same MongoDB transaction. Pending events have no expiry. The envelope contains no credentials or personal profile fields. This implementation does not approve the remaining suspension/provider event names or consumer behavior on behalf of other developers.

Before implementing account suspension/reactivation (ACC-15/ACC-16), agree on the owner-specific event names and payloads for GEN-01/GEN-07. The reusable publisher and consumer are implemented in Omar's feature branch. Password-reset remains on its existing admin outbox producer and consumer.

The implemented consumer polls pending reset events every five seconds and processes up to 50 per poll. Audit creation and the delivered status update commit atomically. A failure rolls back both, leaves the event pending, and is retried on a later poll. A unique audit event ID prevents duplicate records. This event creates an audit entry; GEN-01 does not require a password-reset notification. Atlas transaction availability and a replica-set test harness are required.

Proposed event envelope uses the existing DomainEvent fields, with event types `account.suspended`, `account.reactivated`, `account.password_reset` and `moderator.created`, actor/target IDs, correlation ID, previous/new status where applicable, and provider assignment IDs only when needed. Passwords, tokens, hashes, names and emails are excluded. Producers should include only the notification/audit effects needed for that event. Retry behavior is transaction rollback followed by polling; dead-letter policy and event retention remain open.

The additional event names and payloads above remain review proposals. Omar's notification and audit APIs, plus the password-reset audit consumer, are implemented on `feature/GEN-01-notifications-audit`. No Hassib-, Adham-, or MK-owned producer module has been changed. The remaining event producers and payload details still require owner agreement before their integration is complete.
1. Confirm all statuses and allowed transitions separately for flight and hotel bookings.
2. Confirm exact roles, provider ownership and moderator assignment semantics.
3. Confirm payment provider, currencies, gateway callback verification and refund policies.
4. Confirm events, delivery guarantees, audit retention, sensitive fields, and who can read audit logs.
5. Confirm pagination/filter conventions and requirements workbook field names before exposing endpoints.
6. Confirm whether booking capacities/seat holds and hotel date overlaps require locking or reservation expiry.

Types are in `src/common/auth/authorization.contract.ts` and `src/common/contracts/domain-events.contract.ts`. Authentication and Users use live Mongo schemas and guards. Booking/payment/notification cross-module types remain proposed and unconsumed.

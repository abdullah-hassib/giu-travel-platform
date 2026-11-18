# Notifications and administrative audit logging

Omar's PR #36 is integrated with the actual committed events already produced by Hassib and MK. No existing event schema or booking transaction is replaced.

- GET /api/notifications/unread-count returns { count }.
- GET /api/notifications?page=1&limit=20&unreadOnly=false lists only the authenticated recipient's records, newest first by default.
- PATCH /api/notifications/:id/read marks an owned notification read, preserving readAt on retries.

Active sessions and completed forced password changes are required. Foreign IDs return 404; malformed queries return 400. Responses are no-store. Creation is internal only, with a unique (eventId, recipientId) index.

GET /api/admin/audit-logs preserves the existing administration contract: ten rows per page, actorId/action/inclusive UTC calendar-date filters, stable newest-first order, sanitized target identifiers, outcome=committed and separate deliveryStatus. There is one controller for this route. It combines retained administration/domain envelopes and Omar's successful administrative audit copies, deduplicated by event ID. After delivery the durable copy can preserve the same row if an envelope is archived; application code does not purge queues. Raw payload and audit metadata are not exposed. Internal append-only audit records retain other system effects and failure outcomes without representing failed attempts as committed admin actions.

## Actual event delivery

Consumers poll every five seconds in non-test environments, bounded to fifty events per queue per pass. Each claim, notification/audit effect and delivered acknowledgment shares one MongoDB transaction. A failure leaves the entire event pending. Unique event IDs and recipient indexes, plus transaction write conflicts/retries, protect concurrent consumers and duplicate delivery. No event payload or database diagnostic is logged. Replica-set transaction support is required.

- admin_outbox: account.password_reset, moderator.created, account.suspended/reactivated are audited. Suspension also notifies its target; passwords/tokens never enter an event.
- event_outbox: hotel_booking.confirmed/cancelled notify the booking owner and audit the action; hotel.deactivated notifies assigned moderators and current upcoming Confirmed reservation owners, preserving reservations; hotel.reactivated notifies assigned moderators. Provider recipients are resolved from the actual assignment/booking schemas at consumption. Report dismissal/content hiding/deletion are audited.
- refund_outbox: each Pending/Refunded/Failed refund transition notifies its recorded owner and is audited.
- domain_event_outbox: Omar's typed publisher accepts notification/audit intents within an optional producer session. It remains available for flight schedule/booking integration; its fixture is not claimed as a real flight producer.

Retention is unchanged: delivered envelopes remain retained, and audit copies are immutable by API and uniquely indexed. Consumers retry persistence failures; queue monitoring and poison-event operations remain deployment concerns. Other owners' admin profile mutation producers and actual flight triggers need their integration slices.

Tests use disposable local databases and controlled external payment responses. No private .env, Atlas payment data or live Stripe call is used. See ADMIN_AUDIT_HISTORY.md and the integration tests for canonical route and archive compatibility.

# Notifications and administrative audit logging

This implementation covers the GEN-01 notification read surface, the GEN-07 administrative audit-log read surface, and a reusable durable event handoff for notification and audit effects. The notification route names and response shapes below are treated as agreed for this feature branch. Feature owners still need to wire their domain actions to the event publisher and confirm their event payloads.

## Notifications

The mandatory requirements define an unread count, notification list, and mark-as-read behavior. The agreed routes are:

- `GET /api/notifications/unread-count` returns `{ count }`.
- `GET /api/notifications?page=1&limit=20&unreadOnly=false` returns `{ data, meta }`, newest first by default.
- `PATCH /api/notifications/:id/read` marks the caller's notification as read and returns the notification.

All routes require an active session and scope records to the authenticated user ID. A notification belonging to another user returns 404. Responses use `Cache-Control: no-store`. The mark-as-read operation preserves the original `readAt` on repeat calls.

Notifications are created through `NotificationsService.create`, not a public endpoint. A unique `(eventId, recipientId)` index prevents duplicate delivery for the same event and recipient. `DOMAIN_EVENT_PUBLISHER` is the shared injection token for feature modules; each publisher call carries typed event names plus notification and/or audit intents.

## Audit logs

`GET /api/admin/audit-logs` requires an active administrator session. Travelers and either moderator role are denied. The query accepts `page`, `limit`, `sortBy=occurredAt`, `order`, `actorId`, `action`, `resourceType`, `resourceId`, `outcome`, `from`, and `to`. Pagination follows the shared page/limit response shape, defaults to 20 rows, and caps at 100. Results default to newest first. Arbitrary MongoDB query operators and unrecognized sort fields are rejected.

Audit records contain an event ID, actor, action, resource type and ID, occurrence time, correlation ID, outcome, and optional scalar metadata. A unique event ID makes retries idempotent. Records expose no update or delete route. Metadata keys that indicate credentials or personal contact details are discarded before persistence.

## Current event delivery

Feature modules publish to `domain_event_outbox`. A producer can pass its MongoDB session so its business write and event commit together. The consumer polls every five seconds, up to 50 events per poll, and writes all notification and audit effects while marking the event delivered in one MongoDB transaction. If any effect fails, the transaction rolls back and the event remains pending. A repeated event ID does not reset a delivered event; notification recipient and audit event unique indexes provide an additional idempotency guard. Event payloads are not logged, and sensitive audit metadata keys are removed before persistence.

The generic outbox is currently exercised by an end-to-end fixture for a flight schedule-change event. Feature-owned producers for account/provider suspension, flight schedule and booking changes, hotel reservations, cancellations, and refunds are not wired yet. The existing admin password-reset producer remains on `admin_outbox`; its consumer writes one audit record in a transaction, and GEN-01 does not require a password-reset notification. Confirm event names, recipients, payload fields, and transactional handoff with Hassib, Adham, and MK before integrating their producers. The airport CSV is unrelated to this notification/audit slice.

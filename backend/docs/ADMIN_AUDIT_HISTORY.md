# Administrative action history (GEN-07 read API)

`GET /api/admin/audit-logs` requires an active administrator session with any mandatory password change completed. It reads retained, actually committed account and domain action envelopes already written by the supplied services. It does not wait for Omar's consumer to display a committed action and does not claim a notification or downstream audit was delivered.

Optional validated filters are `actorId`, `action`, inclusive UTC calendar dates `from`/`to`, and `page`. Dates include both whole boundary days. Invalid/reversed dates, unknown actions, malformed actor IDs, unsafe/noninteger pages and extra/operator fields return 400. Output is no-store, ten rows per page, ordered by occurredAt descending then stable event ID descending. A single aggregation combines both source collections and facets rows/counts together; neither source is changed by reading.

Rows contain `id`, `action`, `actorId`, `occurredAt`, `correlationId`, `target: { type, id }`, `outcome: committed` and `deliveryStatus: pending|delivered`. Only identifiers/action/time are projected; no raw payload, passwords, tokens, names, email or payment data is returned. Delivery acknowledgment is separate from the already committed action. Failed/rolled-back actions produce no manufactured success entry.

Covered existing producers are account password reset, moderator creation, account suspension/reactivation, hotel deactivation/reactivation, report dismissal and content hiding/deletion. System hotel-booking events are excluded. Account targets map to targetUserId, hotels to hotelId, dismissed reports to reportId, and moderated content to its actual type/ID. Other owners' provider profile creation/edit actions do not currently emit these reviewed administrative envelopes; full producer coverage must be coordinated when integrating those modules.

## Retention and Omar handoff

`admin_outbox` and MK's `event_outbox` currently retain their records with no TTL. The API uses the supplied schema names and immutable envelope fields; no new event type, shared schema or consumer implementation is introduced. Omar continues to consume committed events idempotently and acknowledge status=delivered. Delivered records remain visible in this history.

Before introducing queue purging or archival, preserve this history by retaining the committed administrative envelopes or integrating a durable archive/read adapter that preserves event IDs, actor, action, target, timestamp and correlation. Removing records before that integration would lose history and must be coordinated. Future airline/provider action types require an explicit reviewed projection. Notification delivery and downstream audit consumer integration remain unfinished.

## Demo and tests

Log in as an admin, suspend/reactivate a traveler or deactivate/reactivate a hotel, then read this endpoint. The committed action appears immediately with pending delivery. Filter by actor/action/date and request page 2. Guests receive 401, non-admins 403, and an administrator who becomes inactive is denied.

`admin-history.e2e-spec.ts` uses actual admin/hotel/auth modules and a disposable replica set. It exercises real actions, all nine existing action mappings, system-event exclusion, acknowledgment retention, combined paging/filtering, positive projection/read-only behavior, rollback, guards, invalid input and Swagger. Fixture delivery acknowledgments are not live Omar delivery. No private environment file, shared database or external API is used.

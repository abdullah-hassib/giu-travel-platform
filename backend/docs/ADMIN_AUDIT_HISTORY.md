> Flight integration update: the read aggregation also projects actual successful audit intents in Omar's domain_event_outbox. Airline creation/profile/policies/provider state and flight creation appear immediately, then deduplicate with their delivered audit copy. The existing response, filters, event IDs, positive projection and ten-row page contract remain preserved. Actual flight booking events remain private system history rather than admin actions. See FLIGHT_PAYMENT_INTEGRATION.md.

# Administrative action history (GEN-07 read API)

`GET /api/admin/audit-logs` requires an active administrator session with any mandatory password change completed. It reads retained, actually committed account and domain action envelopes already written by the supplied services. It does not wait for Omar's consumer to display a committed action and does not claim a notification or downstream audit was delivered.

Optional validated filters are `actorId`, `action`, inclusive UTC calendar dates `from`/`to`, and `page`. Dates include both whole boundary days. Invalid/reversed dates, unknown actions, malformed actor IDs, unsafe/noninteger pages and extra/operator fields return 400. Output is no-store, ten rows per page, ordered by occurredAt descending then stable event ID descending. A single aggregation combines the retained envelope collections with Omar's successful administrative audit copies, deduplicates by event ID and facets rows/counts together; neither source is changed by reading.

Rows contain `id`, `action`, `actorId`, `occurredAt`, `correlationId`, `target: { type, id }`, `outcome: committed` and `deliveryStatus: pending|delivered`. Only identifiers/action/time are projected; no raw payload, passwords, tokens, names, email or payment data is returned. Delivery acknowledgment is separate from the already committed action. Failed/rolled-back actions produce no manufactured success entry.

Covered existing producers are account password reset, moderator creation, account suspension/reactivation, hotel deactivation/reactivation, report dismissal and content hiding/deletion. System hotel-booking events are excluded. Account targets map to targetUserId, hotels to hotelId, dismissed reports to reportId, and moderated content to its actual type/ID. Other owners' provider profile creation/edit actions do not currently emit these reviewed administrative envelopes; full producer coverage must be coordinated when integrating those modules.

## Retention and Omar handoff

`admin_outbox` and MK's `event_outbox` currently retain their records with no TTL. The API uses the supplied schema names and immutable envelope fields; no producer event type or shared schema is changed by the read API. Omar's consumer services now process the actual account, hotel/provider/moderation and refund sources; see NOTIFICATIONS_AND_AUDIT.md. Omar continues to consume committed events idempotently and acknowledge status=delivered. Delivered records remain visible in this history.

Delivered administrative envelopes have durable audit copies, projected with the same event ID, actor, action, target, timestamp and correlation. The API returns one row while both copies exist and preserves it if the delivered envelope is later archived. No application purge/TTL has been introduced. Retain pending envelopes until successful delivery. Actual flight producers and additional provider-profile actions remain for their integration slices.

## Demo and tests

Log in as an admin, suspend/reactivate a traveler or deactivate/reactivate a hotel, then read this endpoint. The committed action appears immediately with pending delivery. Filter by actor/action/date and request page 2. Guests receive 401, non-admins 403, and an administrator who becomes inactive is denied.

`admin-history.e2e-spec.ts` uses actual admin/hotel/auth modules and a disposable replica set. It exercises real actions, all nine existing action mappings, system-event exclusion, acknowledgment retention, combined paging/filtering, positive projection/read-only behavior, rollback, guards, invalid input and Swagger. The combined audit and hotel-payment suites additionally exercise Omar's real consumers, transactional rollback/retry, concurrent delivery and archive compatibility. No private environment file, shared database or external API is used.

# Administration integration plan for review

November 18, 2026. Hassib approved this plan in the conversation before implementation. Scope: his ACC-13/15/16/17 administration responsibilities. Requirements were rechecked against the official workbook. MK/Omar code and Stripe configuration are not available yet. Hassib's approval does not approve a contract on their behalf or authorize modifications to their modules.

## Proposed implementation boundary

Reuse the approved payment design's adapter/transaction pattern. Keep administration services in Hassib's module; Adham/MK implement provider and booking lookups through their own models. Default missing integrations fail with 503. Tests use explicit contract fixtures, and dependent work remains draft until concrete integrations are verified.

1. ACC-13 moderator creation: POST /api/admin/moderators accepts fullName, email, role (airline_moderator or hotel_moderator), providerId and an admin-set temporary password. Derive provider kind from the role. A provider adapter performs an existence check and conditional write using the supplied session, preventing concurrent deletion during creation. In the same transaction create the user with mustChangePassword=true, exactly one assignment in a Hassib-owned moderator_assignments collection, and an outbox event. Password is salted/hashed before the transaction and is never returned or stored in an event. Unique normalized email and unique assignment per moderator prevent races. Multiple moderators may serve a provider; the specification requires exactly one provider per moderator, not one moderator per provider.

2. ACC-15/16 account suspension/reactivation: reuse and update the verified draft PR #9 against current develop. Revoke target sessions/version atomically with the status change and event; no provider status or existing booking is changed. Repeated commands are idempotent. Administrator targets are forbidden. Self-deactivated accounts remain outside this API (409); reactivation only reverses suspension.

3. Provider adapters: airline/hotel owners supply kind, lockExisting(providerId, session), and changeActive(providerId, active, session). The callback owns the provider schema and the conditional state write, returns identity and previous/current active state, and preserves Confirmed bookings. Search and new-booking rejection remain in their modules. Administration emits provider status events in the same transaction. Do not implement these callbacks by guessing collection names or taking over provider modules.

4. ACC-17 booking reads: use a separate booking read adapter per kind for a read-only projection of reference, owner, provider, dates, amount/currency and GEN-11 state. Filters are kind, state and inclusive date range; lists use ten rows. Define exact combined sorting/pagination with concrete booking implementations before exposing an integrated list. No guessed direct collection queries or partial lists presented as complete.

5. Omar's delivery: retain the existing admin_outbox envelope id/type/version/occurredAt/correlationId/actorId/payload/status. Extend allowed types to moderator.created and provider.deactivated/reactivated, in addition to existing account password-reset/status events. Payload uses target/provider/assignment IDs and previous/new states only, excluding names, emails, passwords and tokens. Omar consumes committed envelopes idempotently and acknowledges delivery; no delivered notification/audit is claimed before his consumer is connected. The existing refund envelope is documented in PAYMENT_SETTLEMENT.md.

## Approval and verification

Hassib approved these provider/assignment/outbox boundaries before implementation, as required by the supplied AGENTS.md. No schema-breaking migration or teammate implementation is proposed. Actual provider/search/booking and audit/notification integration still needs team review after their branches arrive.

The administration candidate implements moderator creation, one-provider assignment and its provider lookup port, with DTOs, Swagger and transaction/permission/concurrency tests. It also reuses the account-status implementation and 24 regression cases from draft PR #9, against latest develop. Concrete provider status callbacks, admin booking reads and report/content/audit APIs still await actual team interfaces. See ADMINISTRATION.md for exact implemented behavior.

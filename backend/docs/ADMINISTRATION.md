# Administration candidate and team handoff

November 18, 2026. Hassib approved the provider/assignment/outbox design before this slice. This branch starts from develop 4723ecb and retains the existing account list and temporary-password reset. It adds moderator provisioning and reuses the suspension/reactivation implementation from draft PR #9 (68628b8). Actual provider implementations and Omar's notification/audit consumer are not available yet, so the candidate remains draft.

## Implemented APIs

All routes use the existing opaque-cookie SessionGuard and administrator RolesGuard, DTO allowlists, no-store responses and Swagger at http://localhost:3000/api/docs. Guests receive 401, other roles or mandatory-password-change sessions 403. An inactive administrator cannot act.

| Route | Behavior |
| --- | --- |
| POST /api/admin/moderators | Accept fullName, email, role (airline_moderator or hotel_moderator), providerId and password. Return sanitized identity/assignment and mustChangePassword=true with 201. |
| PATCH /api/admin/accounts/:id/suspend | Empty body. Suspend a traveler/moderator and revoke sessions. Return 204. |
| PATCH /api/admin/accounts/:id/reactivate | Empty body. Restore a suspended traveler/moderator to active; old sessions stay invalid. Return 204. |
| GET /api/admin/accounts | Existing ten-row, filtered/searchable account list. |
| POST /api/admin/users/:id/reset-password | Existing temporary-password reset and forced-change workflow. |

Creation reuses registration's name/email/password validation and normalization, without pretending the administrator accepted guest terms on the moderator's behalf. Only the two moderator roles are accepted. The provider kind derives from the role, and exactly one provider ID is allowed. Existing email returns 409; missing provider 404; invalid adapter identity 502; absent provider integration 503 before user creation. Client roles/status/assignment/security fields cannot override the flow.

The provider conditional lookup, new user, one-provider assignment and pending administrative event commit in one MongoDB transaction. Password hashing occurs before the retryable transaction. Unique normalized email is the final race arbiter. A unique userId in moderator_assignments enforces one assignment per moderator; multiple moderators may serve one provider. Failure writing the assignment or event rolls back the user and provider fence. The temporary password is never returned, logged or included in an event.

At first login, normal protected actions are denied until the moderator changes the temporary password through the existing auth API. That change revokes sessions and requires a new login. The account has only its selected moderator role; it cannot access administration.

Status commands preserve login lockout and forced-password-change state, change only the target account and atomically revoke its access/refresh sessions with a version increment. Repeated/concurrent identical commands create one transition/event. Administrator targets are forbidden (403), absent targets return 404, invalid IDs/body fields 400. Self-deactivated accounts return 409 rather than being recovered through suspension APIs. Confirmed bookings and visible content are not changed by these account operations.

## Provider and authorization integration

Register one ProviderAdministrationAdapter per kind under ADMINISTRATION_PROVIDER_ADAPTERS in AdministrationModule. Its lockExisting(providerId, session) must use the supplied MongoDB session on the default connection and perform a conditional provider write/fence, returning only matching id/kind. Missing providers return 404. Provider deletion or mutation must conflict with that transaction. Default adapters are empty; never replace them with a production fixture.

The separate ModeratorAssignmentsModule has no Auth or provider imports. Adham/MK may import it without creating a module cycle and call ModeratorAssignmentsService.getForModerator(authenticatedUserId). The result contains only providerType and providerId, or null. Their routes must independently enforce the appropriate moderator role and compare this assignment with the resource's owning provider. Never treat a client provider ID as authorization or grant access to a legacy moderator lacking an assignment. Existing users are preserved without fabricated assignments.

Provider deactivate/reactivate callbacks, listing/search/new-booking restrictions and preserving Confirmed bookings remain the provider owners' work. The plan describes that later boundary, but no provider state route or guessed collection query is exposed here. Admin booking reads, reports/content moderation and audit-read APIs likewise await actual authoritative modules.

## Omar's pending event handoff

Collection admin_outbox contains id, type, version=1, occurredAt, correlationId, actorId, payload and status=pending. Event types in this candidate are account.password_reset, account.suspended, account.reactivated and moderator.created. Account event payloads use targetUserId and previousStatus/newStatus when applicable. Creation adds providerType, providerId and assignmentId. No password/hash, token, name, email or raw request is stored in events.

Consume only committed envelopes, deduplicate by id, persist the required notification/audit and acknowledge status=delivered. Delivery failures must remain retryable and observable. This branch has no consumer and claims no delivered audit or notification. Provider event types are planned, not added until corresponding behavior is implemented. Payment/refund envelopes are documented separately in the payment candidate's PAYMENT_SETTLEMENT.md (draft PR #17/#18).

## Demo and verification limits

With a concrete provider adapter registered: seed/log in as an administrator privately, create a moderator for an existing provider, log in with its temporary password, observe protected-action denial, change the password, then log in again. Suspend/reactivate that account from the administrator session and verify its previous cookies cannot revive. Without adapters, creation intentionally returns 503. The status commands can be exercised on isolated test accounts once the candidate branch is selected; their event delivery is still pending.

Tests load real Administration/Auth modules, guards, DTOs and Swagger with disposable MongoDB replica sets. Provider fixtures make real transactional writes. They cover both roles/kinds, normalized duplicates and races, one-provider uniqueness, missing integration/providers, role/privilege-field denial, temporary-password restrictions, assignment/event rollback and status/session/concurrency behavior. No private .env, shared Atlas or teammate module is accessed. Concrete team integration must be verified before merging this candidate.

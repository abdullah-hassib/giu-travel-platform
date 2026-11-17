# Booking policy review and acceptance

PAY-02 service slice, November 17. Implements guarded policy review and timestamped acceptance through the Hassib-approved booking adapter design. Concrete flight/hotel adapters are still supplied by their owners. PaymentsModule registers an empty adapter list until those integrations are connected. A missing adapter returns 503.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | /api/bookings/:type/:id/policies | Review the owner's current applicable policy snapshot, its token and acceptance state. |
| POST | /api/bookings/:type/:id/accept-policies | Accept the reviewed token during a valid Pending Payment hold, preserving the server acceptance timestamp for repeated requests. |

Both endpoints require an active traveler-role session. Guests receive 401, staff-only/mandatory-password-change sessions 403, and foreign/missing bookings 404. Type is flight or hotel and ID is a valid MongoDB identifier. Identifiers and policy tokens normalize hex casing. Responses use no-store and documented Swagger response/error schemas.

POST takes `{ "accepted": true, "policyToken": "<64-character token from GET>" }`. Missing/false/non-boolean consent, invalid token syntax and unknown fields return 400 before the booking adapter is invoked. Clients cannot supply prices, snapshots, user IDs or acceptance dates. Changed quote/policy/deadline tokens and expired/non-pending holds return 409. Re-review before accepting an updated quote.

## Snapshot and consistency

The adapter returns the booking's authoritative owner, provider, GEN-11 state, quote revision, USD amount, hold deadline and applicable policies. Airline snapshots include cancellation tiers and per-segment/cabin baggage allowances, extra-bag limits and extra-bag prices in USD minor units. Hotel snapshots include cancellation tiers and check-in/check-out times. The service validates these fields and constructs a positive projection before returning or storing them. Accidental private adapter fields are omitted. Invalid source data returns a safe 502.

A SHA-256 policy token binds the projected booking identity, owner, provider, revision, price/currency, hold deadline and policies. Cancellation tiers are sorted before hashing. The booking lifecycle state is excluded so a prior acceptance remains recognizable when a booking is confirmed or expires. `canAccept` separately checks Pending Payment and the current deadline.

Acceptance is saved in `booking_policy_acceptances`, unique per booking kind and ID, with the validated snapshot, owner/provider/revision, bound amount/currency/deadline, token and server `acceptedAt`. This preserves the agreed policy data when the provider subsequently changes its profile. Accepting the same current token is idempotent and retains its original timestamp. A newly reviewed token replaces the current acceptance after explicit acceptance. The payment service must take its own immutable accepted snapshot when payment is linked.

The acceptance operation uses one MongoDB transaction. `getOwnedForUpdate` must use the supplied connection/session and perform a conditional booking write before returning its snapshot. A separate fence field can avoid changing the business quote revision during that write. This makes concurrent quote/policy/state changes conflict with acceptance rather than silently accepting stale data. A failure saving the acceptance rolls back that booking write. The adapter must preserve the ten-minute hold rule and never extend a hold merely because policies are reviewed or accepted.

## Adapter registration

The boundary is in `payments/booking-payment.adapter.ts`. Register exactly one adapter per kind through `BOOKING_PAYMENT_ADAPTERS` in PaymentsModule after importing its owning module. An adapter implements `getOwned(userId, bookingId)` for reading and `getOwnedForUpdate(userId, bookingId, session)` for transactional acceptance. Missing and foreign resources must both return 404. Only data from the server-side booking/provider implementation may supply snapshots. The adapter must return the exact GEN-11 states in the contract. Duplicate kind registrations are rejected.

The reusable SDK gateway now lives in StripeGatewayModule, which PaymentsModule re-exports. Refund/gateway consumers can import that module independently of policy persistence. The policy service uses the existing AuthModule, guards, default MongoDB connection and validation conventions.

## Verification and remaining work

The HTTP suite uses the actual PaymentsModule, AuthModule, guards, Swagger and a disposable MongoDB replica set. Its test-only booking adapters perform real conditional booking writes through the supplied session. Tests cover both kinds, consent/token validation, ownership/roles, stale quotes and policy changes, concurrent idempotent acceptance, expiration, snapshot projection and rollback. The normal runtime's empty integration list is verified to return 503. No private `.env`, shared Atlas or Stripe network call is used.

The stacked payment-settlement candidate now requires matching saved acceptance before any gateway call and freezes it on the payment record. Durable payment/refund services and event processing are documented in [PAYMENT_SETTLEMENT.md](PAYMENT_SETTLEMENT.md). PAY-02 remains partial until actual team adapters are integrated and verified.

Hassib also delegated late-payment settlement. The payment-settlement candidate applies an automatic full refund when a verified succeeded payment can no longer be fulfilled after its hold was released, while the booking stays Expired. This compensation is reserved transactionally and retried idempotently.

# Payment settlement and refunds

November 17, 2026. Candidate for PAY-01/02/03/04 and GEN-11, built on the approved payment/booking design and policy-service candidate. This work stays in draft until concrete booking adapters and Stripe test configuration are verified. It does not implement the flight/hotel modules or Omar's delivery consumer.

## Routes and demo

All ordinary routes require an active traveler session and return `Cache-Control: no-store`. Guests receive 401, staff-only/forced-password-change sessions 403 and foreign resources 404. DTOs reject unknown fields. Amounts, currency, provider, user and policy data come from the server. Swagger describes request/response schemas and errors at `http://localhost:3000/api/docs`.

| Method | Route | Input and result |
| --- | --- | --- |
| POST | /api/payments | `{ "bookingType": "flight", "bookingId": "<MongoDB ID>" }`, or hotel. Returns `{ payment, clientSecret }` with 201. Requires a valid hold and matching explicit policy acceptance. |
| POST | /api/payments/:id/retry | Empty JSON object. Reuses/reconciles the existing intent during the same hold. Returns `{ payment, clientSecret }`. |
| GET | /api/payments/:id | Owner-safe status, amount, USD currency, hold deadline, acceptance timestamp and refunds. No client secret. |
| POST | /api/payments/webhook | Original JSON bytes with a valid `Stripe-Signature`. No session cookie required. A successful 200 means the event was processed or safely ignored. |
| GET | /api/refunds/:id | Owner-safe refund amount, currency, reason and Pending/Refunded/Failed status. |

Once real adapters and private test configuration are connected: log in as the booking's traveler; create a ten-minute booking through its owning module; review GET policies and POST its accepted token as described in [PAYMENT_POLICIES.md](PAYMENT_POLICIES.md); initiate payment; use the returned transient client secret with Stripe test Elements; deliver the genuine signed webhook to the backend; read the resulting booking and payment status. A frontend/Elements demo is outside this backend slice. Swagger cannot manufacture a genuine Stripe signature. Repeating requests or webhook delivery must preserve the same logical payment/refund.

Without a registered settlement adapter, creation fails with 503 before any Stripe call. Missing private Stripe setup also returns a safe 503. Configure only the names in [STRIPE_GATEWAY.md](STRIPE_GATEWAY.md), privately. Never paste keys into documentation, chat, commits or request examples. The current verified flow uses synthetic gateway fixtures, not live Stripe.

## Durable state and transaction boundaries

`payments` has one record per booking kind/ID and a unique optional Stripe intent ID. It freezes the accepted policies, policy token, revision, authoritative total, owner/provider and hold deadline. USD amounts must be safe integer cents within the gateway's supported intent bounds. Client totals and client claims of success are never accepted. Only a verified event followed by an authoritative, matching succeeded intent may confirm a booking. Create/retry can report an observed succeeded status while fulfillment remains pending until that event is processed.

The fulfillment field (`pending`, `confirmed`, `expired`) records settlement, not a new booking lifecycle. Booking states retain GEN-11's Pending Payment, Confirmed, Completed, Cancelled and Expired. Confirmation, inventory consumption and payment fulfillment commit in one MongoDB transaction. The adapter must use the supplied session. Stripe calls execute outside transaction callbacks, which may retry. A persisted payment ID supplies the stable Stripe create key, including recovery after a lost response. A per-payment lease serializes attempts, webhooks and expiry; overlapping requests return retryable 409. The lease lasts sixty seconds, exceeds the gateway timeout/retry window, and its token fences stale database writes.

`payment_events` deduplicates verified event IDs and fingerprints their minimal verified metadata. It stores resource/correlation IDs and processing status, not raw card/provider data. A failed application remains pending and returns a non-2xx response; Stripe must redeliver. The service does not run a separate pending-event replay queue. Redelivery retrieves current gateway state, so duplicate or unordered event types cannot regress a succeeded payment. Transaction failure rolls back booking confirmation and event completion together. Unrelated signed resources are ignored. The production middleware preserves raw webhook bytes before normal JSON/urlencoded parsing; signature verification precedes event persistence.

## Hold expiry and late payments

The worker scans up to fifty due records every second outside `NODE_ENV=test`. It prevents overlapping batches, waits for both payment and refund batches, awaits active work at graceful shutdown and backs off database-level failures for one minute. Individual unresolved expiry/refund operations also retry after one minute. Expiry first commits Pending Payment to Expired and releases inventory through the adapter exactly once, then retrieves/cancels the intent. An uncertain original create result is reconciled using its original operation key. A crash leaves a durable unresolved expiry for the next scan.

Hassib delegated the late-success choice. If the hold is expired/released when verified success is settled, the booking stays Expired and a full refund is reserved in the same transaction. No released inventory is reclaimed. The refund worker executes that reservation independently. A late success discovered during expiry reconciliation also triggers compensation; it never confirms an expired booking. Confirmed bookings are excluded from expiry processing.

## Cancellation refund contract

Adham/MK call `RefundsService.enqueueCancellation(input, session)` inside their own cancellation transaction **after server-side authorization and saved-policy tier calculation**. Input is `{ paymentId, bookingId, userId, amountMinor, reason }`; reason is `user_cancellation` or `provider_cancellation`. The same transaction must change the booking from Confirmed to Cancelled, release the appropriate inventory and write the owning module's events. There is no public refund-creation endpoint accepting a client amount.

The service verifies succeeded payment, matching booking/owner and confirmed settlement. Provider cancellation requires a full refund. A zero user refund creates no Stripe operation. The unique cancellation key is derived internally as `cancel:<kind>:<bookingId>` because GEN-11 permits one final cancellation per booking; late compensation uses `late:<paymentId>`. A payment-document fence serializes reservations, and the total Pending/Refunded amount cannot exceed the paid amount. Repeating an identical authorization returns the existing reservation; changing its amount or reason returns 409. Tier/date calculations remain the booking owner's responsibility.

`refunds` stores one durable operation identity, safe amount/linkage and Pending/Refunded/Failed status. The gateway's `refund:<id>:create` key survives uncertain create results. Reconciliation retrieves an existing refund when its ID is known. Temporary failures remain Pending; definitive invalid requests can become Failed. Verified refund events reconcile current authoritative status. Refund status and its notification outbox record commit together. See the gateway documentation for response validation and error mapping.

## Team handoff

Register one `BookingSettlementAdapter` per kind through `BOOKING_PAYMENT_ADAPTERS` in PaymentsModule. Until then the default list is empty. The approved boundary is in `payments/booking-payment.adapter.ts`:

- `getOwned` returns the owner's authoritative snapshot, or 404 for missing/foreign records.
- `getOwnedForUpdate` uses the supplied session and performs a conditional write/fence before returning. Freeze the quote, policies and deadline once linked; do not extend holds on review/retry.
- `linkPayment` associates only this logical payment during a valid hold. Repeated identical linkage is idempotent.
- `confirmPayment` conditionally consumes still-held inventory once and returns Confirmed, or atomically expires/releases the hold and returns Expired. Generate booking references/domain events in that same session. Never independently confirm from a client success response.
- `expirePayment` performs Pending Payment to Expired and releases the hold exactly once. Already-expired calls are harmless. Booking owners must also expire holds for bookings that never initiate a payment.

All callbacks must share the same MongoDB connection/replica set and session. Reconcile the old unapproved `common` booking contracts before adopting them; they are not used by this slice. Actual adapters still require joint inventory/payment race verification. USD must also be enforced in provider pricing and booking creation by their owners.

Omar consumes `refund_outbox` after commit. The pending envelope is `{ id, type: "refund.status_changed", version: 1, occurredAt, correlationId, payload }`; payload has recipientUserId, refundId, paymentId, bookingId, bookingType, amountMinor, currency and refundStatus. ID is `refund:<refundId>:<status>`. Consumer delivery must deduplicate this ID, persist the in-app notification/audit as required, then acknowledge `status=delivered`. Records currently remain pending; no delivered notification is claimed. No teammate module has been changed.

## Verification limits

The settlement HTTP suite loads the real feature modules, guards, Swagger, raw parsers and a disposable MongoDB replica set. Its booking fixtures make real transactional conditional writes; gateway operations are controlled fixtures, and signatures use the official SDK with synthetic credentials. Separate gateway tests exercise the actual SDK through controlled HTTP transport. Worker tests cover scheduling, non-overlap, shutdown and safe failure backoff. These checks do not substitute for real Adham/MK adapters, Omar delivery, shared Atlas or privately configured Stripe test-mode verification.

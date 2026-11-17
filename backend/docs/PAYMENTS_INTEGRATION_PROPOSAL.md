# Payment and refund integration proposal

November 17, 2026. Hassib approved the booking-adapter and transaction design for his service implementation. Adham, MK and Omar still need to connect their concrete adapters and consumers. Hassib delegated late-payment settlement, and automatic full refund is selected when a succeeded payment cannot be fulfilled after the hold was released, with the booking remaining Expired.

## Current dependency check

The team modules were inspected at `7e27229`. FlightBookingsModule, HotelBookingsModule, AirlinesModule, HotelsModule, NotificationsModule, AuditLoggingModule and MediaUploadsModule remain module skeletons. The independent USD/Stripe gateway is now merged in PR #15 at develop `1890556`. Existing common TypeScript booking contracts remain unconsumed proposals. Their states omit Expired and must be reconciled before use. New payment-side adapters will follow the approved GEN-11 lifecycle.

Hassib's backend coverage has 21 implemented primary rows and five partial rows out of 36. The requested 75-percent target requires about six additional completed rows. Policy/payment/refund services and actual booking/provider integration are the next substantial dependencies.

## Requirements fixed by the workbook

- PAY-01 uses Stripe test-mode PaymentIntents and Elements. The backend verifies successful payment through a signed webhook before confirming a booking. Failed payment remains retryable during the hold. Expiry cancels the intent.
- PAY-02 requires provider policy display and timestamped acceptance before payment. Airline policy data covers cancellation and baggage. Hotel policy data covers cancellation and check-in/check-out times.
- PAY-03 issues a positive authorized cancellation refund through Stripe and exposes Pending, Refunded or Failed, with an in-app notification.
- PAY-04 requires one platform currency for flight/hotel prices, payments and refunds. Hassib delegated selection and USD is selected, as implemented in the gateway.
- FLT-22 and HTL-18 require ten-minute holds. GEN-11 permits Pending Payment to Confirmed or Expired, and Confirmed to Completed or Cancelled. Booking owners implement their inventory and lifecycle rules.

Exact mandatory rules come from the [official workbook](https://drive.google.com/file/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/view). The supplied implementation guide includes these requirement IDs for convenient cross-reference.

## Proposed ownership and integration contracts

| Boundary | Producer/owner | Required behavior |
| --- | --- | --- |
| Payable booking lookup | Adham for flight, MK for hotel | Given authenticated user ID, booking kind and ID, return an owned Pending Payment booking with its authoritative total, currency, hold deadline, provider ID and immutable policy snapshot/revision. Reject inaccessible, expired or changed bookings. |
| Booking payment linkage | Adham/MK with Hassib | Atomically associate one logical payment with the booking and its policy acceptance/revision. Concurrent initiation/retries must converge on that same payment. The exact shared fields await adapter agreement. |
| Confirmation and hold expiry | Adham/MK | Accept the supplied MongoDB session and perform a conditional state/inventory update. Confirm only a still-valid held booking after the verified matching payment. Expire the booking and release inventory exactly once. Include booking reference generation and their own domain events. |
| Payment and policy persistence | Hassib | Store guarded linkage and immutable acceptance data, correlate the Stripe intent, verify signatures and test mode, enforce the accepted total/currency/policy revision, and coordinate idempotent settlement. |
| Cancellation refund authorization | Adham/MK | Supply a stable cancellation ID, booking/payment ID and final authorized integer minor-unit refund amount after applying the booking's saved policy. The provider owner supplies tier selection/date interpretation. Provider cancellation requires the workbook's full refund. |
| Stripe refund processing | Hassib | Check the authorized amount against the verified paid amount and platform currency, create/reconcile one Stripe refund per cancellation operation, record its result and expose it to authorized booking views. |
| Audit and in-app delivery | Omar | Idempotently consume committed events using their event ID and persist the required audit/notification record. Agree event names, payload fields, retry behavior and consumer acknowledgement before wiring. |

An adapter accepts a transaction session so payment state, booking state, inventory and required outbox records can commit together on the existing MongoDB replica set. Stripe requests run outside transaction callbacks because those callbacks may retry. Outbound requests use persisted logical-operation identities and Stripe idempotency keys. The proposed integration uses the repository's existing connection and authentication guards.

For a verified successful payment when inventory has already been released, the selected compensation is an automatic full refund. The booking remains Expired under GEN-11. The services must record and retry that refund idempotently and notify through Omar's integration. Hassib delegated this settlement choice on November 17.

## Proposed API behavior

| Route | Authentication and behavior |
| --- | --- |
| GET /api/bookings/:type/:id/policies | Active traveler, owned booking. Return its saved applicable policies and revision for review. |
| POST /api/bookings/:type/:id/accept-policies | Active traveler, owned payable booking, explicit boolean acceptance and the displayed revision. Persist the server timestamp and immutable accepted snapshot. Changed policy revision requires review again. |
| POST /api/payments | Active traveler and owned payable booking with accepted matching policies. Accept booking identity and an operation key. Derive amount, currency, ownership and hold deadline from server data. Return the owner-safe payment view and the client secret needed by Elements with no-store caching. |
| POST /api/payments/:id/retry | Same owner checks and an active hold. Reconcile/reuse the existing intent and acceptance. An uncertain create result is retried with the same persisted operation identity. |
| GET /api/payments/:id | Owner-safe payment status through the existing session guard. Explicit admin/moderator booking read access is integrated through ACC-11 adapters. |
| POST /api/payments/webhook | Exact raw request bytes and a valid Stripe signature. Verify test mode, intent linkage, amount and currency. Durably deduplicate events and apply conditional state changes. A durable failed application remains retryable. |
| GET /api/refunds/:id | Authorized booking reader. Return the refund amount, platform currency and Pending/Refunded/Failed status. |

All proposed bodies use DTO allowlists, valid identifiers and documented errors. Raw card data stays in Stripe Elements. The Stripe secret key, webhook signing secret and payment client secret stay out of stored diagnostics and ordinary status responses. The initial payment flow's client secret is restricted to the authorized client response and is never logged.

Webhook verification depends on the original request bytes. Stripe's documentation describes signature verification and handling duplicate or unordered delivery. API request idempotency protects repeated outbound operations. These are separate controls in this proposal. [Webhook guidance](https://docs.stripe.com/events/manage-webhook-endpoints), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [PaymentIntents](https://docs.stripe.com/payments/payment-intents), [refunds](https://docs.stripe.com/refunds)

## Proposed implementation order and verification

1. Use the selected USD currency and Hassib-approved adapter design. Implement his services against that boundary, then connect the team implementations. Resolve late-payment/hold-expiry settlement before finalizing that race behavior.
2. Build policy display/acceptance and payment linkage in a requirement-scoped branch. Verify ownership, stale policy/amount rejection, timestamping and concurrent acceptance/initiation against a disposable replica set.
3. Build test-mode Stripe creation/retry/webhooks with durable event handling. Cover invalid signatures, altered bytes, duplicates, unordered events, mismatched IDs/amounts/currencies, transient failures and simultaneous expiry/payment.
4. Build refund creation/reconciliation and Omar's delivery handoff. Verify duplicate cancellations and webhook retries cannot issue excess refunds, and refund status follows the verified gateway result.
5. Connect the actual flight/hotel adapters and run their inventory/hold scenarios together. Verify Stripe test-mode flow using privately configured credentials. Merge each completed verified requirement slice into develop and update coverage from its actual behavior.

Each branch retains DTO validation, session/role/ownership enforcement, Swagger documentation and meaningful tests. Test doubles can verify the proposed boundary while the actual team adapters are pending. Full requirement coverage is recorded after the real integrations pass.

## Inputs awaiting the team

- Branch names or concrete interfaces for booking/provider/inventory and Omar's notification/audit integration.
- Private Stripe test configuration using `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, or confirmed alternative variable names. Reply only with configuration status. Secret values belong in private local configuration.

The user previously asked to defer complex work in teammate-owned areas. Expanding that ownership would require a new explicit scope decision.

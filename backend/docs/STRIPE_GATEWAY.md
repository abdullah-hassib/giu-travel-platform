> Current November 20 submission: [checklist](M1_SUBMISSION_CHECKLIST.md), [verified handoff](M1_BACKEND_HANDOFF.md) and [genuine Stripe execution record](STRIPE_SANDBOX_ACCEPTANCE.md). The mandatory backend and HTL-26 bonus passed 209 unit and 660 HTTP/database tests. Older remaining-integration statements below are historical checkpoints; the current handoff records completed payment/refund/webhook/expiry verification and runtime demonstration instructions.

# Stripe test gateway and USD decision

November 17, 2026. Hassib delegated the PAY-04 currency selection, and USD was selected for flight/hotel prices, payments and refunds. `payments/platform-money.ts` exports the shared value for future booking/provider adapters. The itinerary FX preference continues to describe itinerary budgets independently.

## Implemented gateway boundary

PaymentsModule exports StripeTestGateway. The gateway uses the pinned official Stripe Node SDK 23.1.0 with its default API version `2026-10-28.endive`. The SDK supports the project's Node 20 baseline. The default client uses a five-second request timeout and up to two SDK network retries. Methods validate positive integer USD amounts and normalized internal MongoDB payment/refund IDs before sending a request.

| Method | Implemented behavior |
| --- | --- |
| createIntent | Create an automatic-capture, card-allowed PaymentIntent with payment record correlation and stable `payment:<id>:create` idempotency key. Return a minimal internal result and transient client secret. |
| retrieveIntent | Retrieve and verify intent ID, payment linkage, test mode, amount, USD currency and automatic capture. A succeeded intent must report the complete expected received amount. Use this method to reconcile current status during retries. |
| cancelIntent | Retrieve/verify first. Return an already canceled intent idempotently, or cancel an unpaid intent using `payment:<id>:expire`. A succeeded intent requires refund handling. |
| createRefund | Verify a succeeded paid intent, positive authorized refund amount bounded by the original payment, and USD currency. Create using `refund:<id>:create` and return only linked refund metadata. |
| retrieveRefund | Verify payment/refund linkage and report Pending, Refunded or Failed. Provider pending/requires_action/null maps to Pending; succeeded maps to Refunded; failed/canceled maps to Failed. |
| verifyWebhook | Verify the original Buffer and Stripe-Signature with the official SDK and its standard timestamp tolerance. Accept test-mode event envelopes, return minimal event/resource identity, and identify unrelated event types as unhandled. |

Payment methods accept a trusted internal payment identity, amount and currency. Refund methods also accept the authorized refund record/amount. HTTP consumers must first enforce account ownership, policy acceptance, hold expiry and cancellation authorization through the agreed booking adapters. This gateway boundary supplies outbound Stripe operations and verification. The stacked settlement candidate adds durable payment/refund/event persistence and booking callbacks; see [PAYMENT_SETTLEMENT.md](PAYMENT_SETTLEMENT.md).

Stripe USD PaymentIntents accept 50 through 99,999,999 cents. The gateway enforces these documented limits. Provider and booking owners need to validate payable totals against them when integrating. Refunds may be smaller than fifty cents and must remain within the original verified paid amount. The SDK remains the authority for remaining refundable balance. [Stripe amount parameters](https://docs.stripe.com/api/payment_intents/create), [refund API](https://docs.stripe.com/api/refunds/create)

## Private configuration

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` privately when Stripe test setup is ready. Test secret/restricted key prefixes are supported. Live-mode keys are rejected. Configuration is checked lazily, so backend startup remains available while the keys are missing. A gateway operation without the required private configuration returns a sanitized 503. The verifier requires its signing secret independently of the API key.

The gateway returns a transient client secret to its trusted caller for a future authorized Elements/retry response. Consumers must omit it from persistence, status views and logs. Gateway views exclude raw Stripe objects, card details, provider diagnostics and the private keys. Provider/transport failures produce safe application errors, and a network retry retains the logical operation key. The caller must persist the operation identity before an outbound request.

Signed event verification supplies minimal event/resource identity and validated internal metadata IDs for durable deduplication and transactional processing. The settlement candidate requires both a verified event and a reconciled matching succeeded intent for confirmation. Its HTTP middleware preserves raw bytes before global JSON parsing and acknowledges only after required durable work succeeds. [Stripe webhook guidance](https://docs.stripe.com/events/manage-webhook-endpoints), [idempotency](https://docs.stripe.com/api/idempotent_requests)

## Verification and remaining integration

The test suite uses the actual Stripe SDK with a controlled in-memory HTTP transport and synthetic credentials. It verifies request encoding, stable idempotency, USD/provider bounds, response correlation, cancellation/refund behavior, safe failures, signature integrity/timestamp tolerance and minimal output. A Nest module test verifies the real provider configuration and lazy missing-key behavior. These tests perform no Stripe network requests and load no private `.env`.

Stripe test credentials and actual team booking/provider/notification/audit adapters are still pending. Hassib approved the transaction/policy/booking design in [PR #14](https://github.com/abdullah-hassib/giu-travel-platform/pull/14). Policy review/acceptance and payment/refund settlement services are implemented as draft candidates through that boundary. Their tests use controlled gateway responses and transactional booking fixtures. Actual inventory integration, live test-mode verification and notification delivery remain unverified. PAY-01/02/03/04 retain partial coverage. Concrete adapters remain their owners' integration work.

# Real Stripe sandbox acceptance plan

PAY-01/02/03, FLT-23/26, HTL-17/21 and GEN-01/11. This is an opt-in external test, separate from the default offline unit/e2e suites. Its default invocation prints the plan without reading credential variables or contacting Stripe.

The harness creates a fresh loopback MongoDB replica set and independent application/listener. It never uses the configured shared MongoDB URI. All users/providers/bookings are synthetic and local. It creates at most three real Stripe test-mode PaymentIntents: two successful payments and one unpaid expiry case, with full refunds for successful cases. It uses Stripe's named test PaymentMethods, never raw card details.

Checks:

1. Actual flight payment, genuine SDK-verified webhook, confirmation/inventory/reference, PDF, signed replay and tamper rejection.
2. Whole-flight provider cancellation and an actual full Stripe refund, including genuine refund webhook processing.
3. Actual hotel payment decline, genuine failure webhook, retry/success, user cancellation and full Stripe refund.
4. Forced deadline on only the disposable fixture, real unpaid-intent cancellation, booking expiry and released seats. This does not claim ten real minutes elapsed.
5. Actual committed notification/audit delivery.

The normal listener forwarding to the shared application's port must be stopped first: Stripe broadcasts the same test events to all listeners. The harness has its own bounded CLI child and uses the configured test API key through the child environment, never process arguments. It captures its private output internally, verifies the signing secret matches the configured sandbox, and never prints keys, client secrets, raw events, card data or provider error messages. Signed payloads remain only in memory for replay and are discarded afterward.

Prerequisites: explicit authorization for a local process to consume private Stripe keys without displaying them; backend test dependencies and mongod; Stripe CLI; matching sandbox API/signing keys; confirmation that other local webhook forwarders have stopped. No live-mode key is accepted. No shared Atlas fixture, seed or migration is performed.

Preview without credential access/network, from backend:

```powershell
node --require ts-node/register test/acceptance/stripe-sandbox.acceptance.ts
```

Verify the synthetic provider/inventory/hold/policy fixtures through actual backend APIs, also without loading private configuration or calling Stripe:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe'
$env:MONGOMS_VERSION='8.2.7'
$env:MONGOMS_RUNTIME_DOWNLOAD='false'
node --require ts-node/register test/acceptance/stripe-sandbox.acceptance.ts --verify-fixtures
```

This offline fixture mode does not create PaymentIntents or verify payment/refund/webhook behavior. It must be invoked without `--env-file` and separately from `--execute`.

Only after operator authorization, the external run may load backend/.env through Node's normal runtime environment loader:

```powershell
node --env-file=.env --require ts-node/register test/acceptance/stripe-sandbox.acceptance.ts --execute --listener-stopped
```

The external command consumes private configuration and requires explicit permission for runtime credential use. Credential values must remain hidden. A tool/process report contains only stages, safe provider error classifications and pass/fail checks.

The harness cleans only its own Stripe objects after failure, checking test mode and payment metadata ownership first. It cancels unpaid intents and refunds any remaining amount on its own test charges. Stripe retains its normal test transaction history. The harness terminates only its own listener/app/database and verifies the temporary media path before deletion.

No successful real Stripe acceptance run is claimed until the opt-in execution completes and its report is reviewed.

November 19 preparation evidence: typecheck, build and lint passed; 209 unit tests passed; plan-only invocation passed; actual offline fixture verification and cleanup passed. No private configuration was loaded and no Stripe operation was performed for those checks. The complete backend's latest earlier regression checkpoint remains 647 HTTP/database tests. The acceptance harness remains draft pending the real external run.

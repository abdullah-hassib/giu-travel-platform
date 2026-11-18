# Milestone 1 integration candidate — 18 November 2026

This **draft integration branch** is composed from the last verified `develop` head
(`c831891`), MK's hotel/community PR #23 plus the review-repair PR #24,
Hassib's payment-policy/settlement/recovery stack (#16–#18), and the
moderator-provisioning/account-status draft #19. Nothing here has been
merged into `develop`.

## Actual code wiring proposed

- `PaymentsModule` imports `HotelBookingsModule` and registers MK's
  `HotelPaymentAdapter` under `BOOKING_PAYMENT_ADAPTERS`. Only the hotel
  adapter exists; flight payment requests must still return unavailable.
- `AdministrationModule` imports `HotelsModule` and registers
  `HotelsService.lockExisting` as the hotel provider adapter for
  `ADMINISTRATION_PROVIDER_ADAPTERS`. Airline provider administration
  is still unavailable until Adham delivers the provider boundary.
- `HotelBookingsModule` imports `RefundsModule`. For a confirmed paid
  reservation, `HotelBookingsService.cancel` calls
  `RefundsService.enqueueCancellation` with the saved policy-derived amount
  **inside the same MongoDB transaction** that changes booking state,
  so a missing/invalid payment or failure to reserve the refund rolls back
  the cancellation instead of silently leaving a customer unpaid.
- MK's existing isolated hotel e2e tests use a `RefundsService` test double
  because their `pay_1` fixture is not a persisted real payment. **These
  tests are not full payment/refund integration evidence.**
- Moderator-hidden itineraries now have a non-owner-controlled flag.
  Deleting post media happens only after a successful database commit.
  Reference-data fixture tests normalize line endings before adding CRLF.

## Mandatory verification before any merge

From `backend/`, on a developer machine or CI with installed dependencies:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
```

Then run the assembled `AppModule` with privately configured *test*
MongoDB Atlas (transactions/replica set), Stripe **test** credentials and
webhook signing secret. Do **not** share secrets in a PR, issue or chat.
Confirm Swagger starts and follow this sequence:

1. Seed/reference-check the four official datasets in the **approved** dev DB.
2. Admin creates a hotel; admin provisions a hotel moderator; confirm exact
   assignment and first-login password-change restrictions.
3. Moderator adds a room, availability and hotel policies; traveler creates
   a ten-minute Pending Payment hold.
4. Traveler reviews and accepts policies, creates/retries one USD payment
   intent, completes Stripe test payment; only a **signed webhook** may confirm.
5. Verify duplicate/out-of-order webhook, hold-expiry/payment race and
   simultaneous competing room holds cannot confirm twice or oversell.
6. Cancel a Confirmed booking before check-in. Verify the computed policy
   refund becomes one durable refund reservation **in the same transaction**
   and eventually reaches the authorized Stripe test refund state; induce
   a refund-enqueue error and verify cancellation is rolled back.
7. Verify hotel deactivation, moderator ownership, account suspension,
   blog/report moderation, and owner republish denial.
8. Check audit/notification outbox backlog against Omar's actual consumer
   only after that consumer is delivered.

## Known remaining blockers

- **Adham**: no flight/airline inventory or booking/provider adapter has
  been integrated. This candidate is **hotel-only** on the payment/admin side.
- **Omar**: `event_outbox`, `admin_outbox` and payment/refund notification
  outboxes do not yet have a confirmed end-to-end consumer/delivery check.
- **Stripe**: no live test-account webhook was run in this assistant workspace.
  Mocked SDK tests are not sufficient for release sign-off.
- **GitHub CI**: no independent build/lint/test result has been obtained for
  this combined code. Earlier PR-level test claims do not prove this
  composite passes. Fix all red suites before merging.
- **Historical merge conflicts**: #16 and #19 diverged from the newer
  `develop` docs/source tree. The integration branch composes relevant
  source files over the latest baseline rather than merging either stale
  draft blindly. It is **not** a substitute for a tested conflict resolution
  and source review.
- **Media**: post-commit cleanup is best effort; a crash after DB commit
  may leave an orphan image. A durable cleanup queue can harden this.
- **Dependency audit**: the existing dependency advisories are still open;
  assess before deployment rather than applying unreviewed forced upgrades.

These are integration preparations, not a declaration that Milestone 1 is
complete. The source changes are AI-assisted; see `AI_PROMPTS.txt` and
obtain team review before release.

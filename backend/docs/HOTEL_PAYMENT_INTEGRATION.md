# Hotel, payment and administration integration

November 18, 2026. Integrates MK's PR #23, the moderation/media consistency repairs in #24, and the supplied wiring from #25 with Hassib's merged services in #26. Original MK and review commits are retained. This document describes actual integration behavior; earlier branch handoff notes are historical.

## Connected services

- `AdministrationModule` registers `HotelsService.lockExisting` as the real hotel provider adapter. Moderator creation checks and fences the hotel in the same transaction as the account, exactly one assignment and administrative event. Hotel routes enforce that assignment after the required first password change (ACC-13/ACC-11).
- `PaymentsModule` registers the real `HotelPaymentAdapter`. Policy acceptance and the authoritative held quote feed payment creation. Only signed, reconciled payment success may confirm the actual hotel booking and create its reference (PAY-01/02, HTL-17).
- Hotel cancellation calls the real `RefundsService.enqueueCancellation` inside its transaction, using the saved booking policy. Reservation failure rolls back cancellation and its event. Repeated cancellation returns 409 and cannot create another refund (PAY-03/04).
- Success received after a released hold keeps that booking Expired and reserves a full refund; a replacement booking keeps the room. No expired hold is restored.
- MK's hotel status operation preserves Confirmed bookings and allows their normal cancellation after deactivation. New holds against that provider are rejected. Canonical `/api/admin/providers/...` aliases remain to be added.
- Report/content moderation includes the reviewed persistent itinerary hide flag, owner republish prevention, and post-image cleanup after commit. No duplicate report engine was introduced.

## Repeatable verification

`test/hotel-payment-integration.e2e-spec.ts` loads the actual administration, hotel, booking, payment, policy and refund modules without replacing either adapter registry or `RefundsService`. It uses a disposable local MongoDB replica set. Only external Stripe requests are controlled; webhook signatures use the official Stripe SDK. No private `.env`, shared Atlas data or live Stripe resources are used.

Seven cases cover real moderator provisioning/password restrictions/assignment isolation, missing provider rollback, policy acceptance requirements, owner privacy, invalid signatures, confirmation/replay/inventory, saved-policy cancellation/refunds, cancellation rollback, late payment compensation and provider deactivation. The existing contract-fixture suites remain useful for flight and failure cases; they are not evidence of an actual flight implementation.

Run the standard backend checks and `npm run test:e2e`; on this Windows machine the disposable MongoDB harness uses the installed `mongod.exe` through `MONGOMS_SYSTEM_BINARY`, with runtime downloads disabled. Test setup never starts the shared application against Atlas.

## Swagger sequence

1. Log in as an administrator; create a hotel through `POST /api/hotels` with an official city/country.
2. Create its moderator through `POST /api/admin/moderators` with role `hotel_moderator` and the hotel ID. As that moderator, change the temporary password and log in again.
3. Add rooms, availability and cancellation policies using MK's documented hotel endpoints.
4. As a traveler, create a hold through `POST /api/hotel-bookings`.
5. Review `GET /api/bookings/hotel/:id/policies` and accept its token through `POST /api/bookings/hotel/:id/accept-policies`.
6. With private Stripe test configuration, initiate through `POST /api/payments`; complete the test payment and deliver Stripe's genuine signed event. Swagger cannot manufacture verified success.
7. Read booking/payment status, then cancel through `POST /api/hotel-bookings/:id/cancel` and inspect the refund as its owner.

Live Stripe verification remains pending because credentials are unconfigured. Missing flight adapters fail safely with 503. Omar's notification/audit consumer has not been supplied; committed outbox events are pending delivery, not delivered notifications. Activity image integration, itinerary provider searches, remaining admin read operations and the account-deactivation booking guard are separate unfinished work.

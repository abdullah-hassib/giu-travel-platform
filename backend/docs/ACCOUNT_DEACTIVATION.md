> Flight integration update: the account lifecycle transaction now also checks actual Confirmed flight segments whose arrival is still current/upcoming. The same user/payment write fence serializes flight confirmation and account closure. Real HTTP tests cover blocked closure, post-cancellation closure and concurrent confirmation/closure. See FLIGHT_PAYMENT_INTEGRATION.md. Earlier hotel-only limits below describe the original slice.

# Account deactivation and hotel booking guard (ACC-12)

`DELETE /api/users/me` retains its existing 204/cookie-clearing contract and requires an active session with no mandatory password change pending. `AccountLifecycleService` now commits account status, session-version invalidation and deletion of current owner sessions in one MongoDB transaction. Session cleanup failure rolls back the status change.

An upcoming/ongoing Confirmed hotel stay blocks deactivation with 409. The predicate uses MK's supplied hotel schema and established UTC lifecycle rule: userId, status=Confirmed, checkOut >= today. The guard does not mutate booking records or lazily advance statuses. Past stays, Cancelled/Completed/Expired bookings and Pending Payment holds do not block this requirement. Rejected deactivation preserves account status/version, sessions and bookings. Public itinerary/blog/image author-status rules automatically hide a deactivated author's public content.

## Payment/deactivation concurrency

Both deactivation and payment initiation/settlement conditionally write the same user document inside their transactions. A private, nonselected `bookingFence` counter gives payment a real account write without invalidating sessions or changing a client quote. No client DTO/view exposes it; missing legacy counters are incremented from zero. No teammate service, booking adapter signature, policy token, money or hold duration changes.

If verified confirmation commits first, deactivation retries and sees the upcoming Confirmed booking, then returns 409. If deactivation commits first, new payment preparation is denied and pending verified success cannot confirm the closed account. Its already verified event remains durable with the existing retry/backoff. At the normal hold deadline the existing worker expires the booking and reserves a full refund; no inventory is restored. This preserves the approved ten-minute hold and expiry callback contract. The webhook may return retryable 409 until expiry. Suspended owners retain valid existing booking fulfillment under ACC-16.

## Integration and demo

The hotel guard is concrete. Flight booking checks must be added with compatible Adham code; his initial b269bd1 branch is not integrated and cannot yet establish combined ACC-12 acceptance. The shared payment account fence is ready for future compatible flight settlement. No invented flight collection query or early hold-release contract is used.

Swagger demo: a traveler with a paid future hotel booking receives 409 on deactivation and can still use its session. Cancel the booking through its owning API, then deactivate: the account becomes inactive, all current sessions are deleted, both cookies are cleared and login is denied. The atomic/race tests use actual modules, MongoDB transactions and SDK-verified synthetic webhook signatures; external Stripe calls are controlled. No shared Atlas or live Stripe resources are used.

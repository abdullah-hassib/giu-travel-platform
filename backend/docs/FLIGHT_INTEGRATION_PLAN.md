# Adham/Hassib Milestone 1 integration review

Reviewed submission: PR #31, b269bd1, against develop aab914e. Omar's PR #36 is present and is being reconciled separately. This plan covers mandatory backend requirements only; no shared database migration or seed is authorized by this plan.

## Blocking conflicts and proposed resolution

1. Adham's airport schema uses MongoDB ObjectIds and a separate airport seed, replacing the already verified official reference service. Keep the current five official reference endpoints, source/checksum readiness and approved seed unchanged. Use ReferenceDataService airport lookups and the existing IATA string identifiers in flight references. Do not run Adham's alternative seed or replace shared Atlas records. Keep his airport-local/UTC conversion and DST rejection, with tests adapted to the official records.
2. His airline creation requires an existing moderator, while the approved administration flow requires a provider before creating its moderator. Keep the already approved create-provider, then provision-moderator flow used by hotels. Create the airline initially unassigned, then authorize via the actual moderator_assignments collection. Add the airline existence/fence adapter. Do not create a parallel authority using Airline.moderatorId, bypass forced password change, or register moderators as travelers.
3. The hold service uses broad Model<any> types and manual transactions without automatic transient-conflict retries, has no expiry/release worker, and cannot settle payments. Narrow models to actual schemas, preserve passenger/price validation, implement the approved BookingSettlementAdapter and reuse existing payment/refund services, USD and signed-event recovery. Fence provider/flight/inventory writes so suspension/cancellation, expiry, payment and concurrent holds cannot oversell or release twice. Store immutable policy/price snapshots, with one payment/reference for a round trip.

Hassib explicitly approved this plan in the November 18 session before implementation. These changes affect Adham's unmerged models/services and shared integration wiring. Existing official reference collections, merged hotel functionality and authentication remain preserved. If legacy flight documents exist outside this repository, their migration needs a separate review rather than an implicit destructive conversion.

## Sequential verified slices

- Foundation reconciliation: airline creation/assignment and authorization, official airport identifiers/time zones, typed flight creation, provider administration adapter. Cover FLT-01/02/03/04/08/09 and ACC-13/15 with real HTTP/database tests and existing unit validation preserved.
- Search/details and itinerary reuse: active-provider/Scheduled/date/seat queries, one-way/round-trip options, cabin/price filters, sort/pagination, local times and derived Departed state. Add owned itinerary first-city airport search. Cover FLT-11/12/15/17/30 and ITN-26.
- Booking settlement: atomic one/two-segment holds, saved passengers/baggage/policies, expiry/release, verified Stripe settlement and late-success refunds; cancellation/refund preview and whole-booking cancellation. Cover FLT-19/21/22/23/26 and PAY-01/02/03/04.
- Account/admin integration: upcoming flight booking guard, sanitized flight/combined administrator booking pages with one global count/order, owned traveler and assigned-moderator booking/passenger reads. Cover ACC-11/12/17 and FLT-25/29.
- Flight operations and delivery: safe schedule/capacity edits, confirmed-passenger notifications, provider and flight cancellation with full refunds and pending hold release; downloadable e-ticket and passenger CSV required by FLT-23/29. Connect actual flight producers to Omar's durable consumer. Cover FLT-05/06, GEN-01/07/08 as applicable.

Each slice starts from current develop, updates Swagger/DTOs/AI_PROMPTS and requirement coverage, runs source checks/unit tests and meaningful disposable replica-set HTTP/race tests, and is merged only after passing. Preserve author history when composing the submitted branch. Do not merge #31 wholesale with failing reference/assignment/payment behavior.

## External acceptance limits

Live Stripe test credentials remain unconfigured. Local signature, transaction, race and controlled-gateway tests can verify code but cannot establish successful live Stripe payment/refund acceptance. No shared Atlas payment fixtures, credential reads or live payment operations are part of this integration approval. Full acceptance also needs a working runtime demonstration after private configuration is available.

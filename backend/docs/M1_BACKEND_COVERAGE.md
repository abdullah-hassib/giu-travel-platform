# Hassib Milestone 1 delivery checklist — November 18

Scope follows Hassib's personal task allocation and the official GIU PDF/workbook. The user explicitly requested merging the previously tested service drafts and continuing the remaining assigned backend work. This checklist separates implemented services from concrete integrations still needed for end-to-end acceptance. Merging code does not imply that a missing provider, booking, media or notification implementation has been supplied.

| Requirements | Implemented service behavior | Remaining acceptance work |
| --- | --- | --- |
| ACC-01/04/05/06/07a/08/09/14/19 | Registration/consent, secure-cookie access/refresh rotation/expiry, lockout, profile, admin list/reset and forced password change. | Live HTTPS browser verification; preserve these working flows during integration. |
| ACC-11 | Owner checks on itineraries, policy/payment/refund routes; moderator assignment read service. | Concrete booking/provider ownership and admin booking reads. |
| ACC-12 | Soft deactivation/session revocation and public-itinerary author hiding. | Upcoming Confirmed booking guard and deleted-user rendering in other modules. |
| ACC-13 | Admin moderator creation, exactly one provider assignment, temporary-password restrictions and atomic event. | Actual airline/hotel existence adapters. Missing configuration returns 503. |
| ACC-15/16 | Admin suspension/reactivation, session invalidation, idempotency, transaction rollback and durable events. | Provider activation service/callbacks and required notification integration. |
| ACC-17 | Approved read-only booking projection boundary is documented. | Concrete flight/hotel projections, combined pagination and filters. |
| ITN-01/03/05/07/08/09/10/14/16/18/20/21 | Private CRUD, ordered days/activities, dates/groups, all cost types, native/preferred-currency summaries, visibility/search and independent cloning. | Preserve current behavior; media and provider searches are separate requirements below. |
| ITN-12 | Activity CRUD is implemented. | Shared media validation/storage and image attachment/removal. |
| ITN-25/26 | Itinerary dates/city groups and authoritative reference locations are available. | Reuse MK's hotel and Adham's flight search services once their code is supplied. |
| PAY-01/02 | Policy review/acceptance and immutable quote binding, owned create/retry/status, signed raw webhook settlement, expiry/recovery and duplicate protection. | Concrete booking/inventory adapters and privately configured Stripe test verification. |
| PAY-03/04 | Bounded cancellation/late-payment refund reservations, gateway reconciliation, durable notification events and USD enforcement. | Booking cancellation callbacks, provider/booking USD pricing and actual notification delivery. |
| GEN-07 | Administrative actions produce durable, sanitized transactional records. | Admin history read API and retention/consumer handoff. |
| GEN-10 | Required administration APIs and ownership boundaries are documented. | Report workflow and content moderation, including actual itinerary integration. |

The previous 21/36 count described completed integrated requirement rows. Further policy/payment/refund/moderator/status services are implemented and tested, and are being merged at the user's explicit direction. Do not use that old count to suggest the additional implementation is absent; equally, do not mark missing team integrations complete merely because their service interfaces exist.

Kuwaity's separately authorized GEN-12/FLT-02 reference implementation is merged, shared Atlas seeding succeeded and all source records were independently verified. It does not add rows to Hassib's original 36-row allocation. All current synchronous location/currency consumers share the reviewed source; flight/hotel owners must reuse the exported database lookup service.

Priority after merging: provider administration and administrative history, then report/content moderation for owned itinerary content, followed by concrete team adapters, media/search and live payment verification. Optional features and teammate domain implementation remain outside this task.

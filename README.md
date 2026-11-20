# GIU Travel Planning and Booking Platform

Milestone 1 backend deadline: November 20, 2026. Milestone 2 frontend deadline: December 11, 2026.

The NestJS/TypeScript backend integrates authentication/users/administration, flight and hotel search/inventory/bookings, policy acceptance/payments/refunds, itineraries/budgets/FX, reviews/blog/community, server media, notifications/audit and official references. Mandatory backend features in the reviewed scope are implemented, including flight roster/CSV, private e-ticket PDFs, airline logos and hotel profile/photo audit events. Real Stripe test-mode payments, signed webhooks, decline/retry, refunds and unpaid expiry were verified on November 19 using disposable local databases. The user's running readiness and Swagger endpoints also returned 200.

Typecheck, build and lint passed, with 209 unit tests and 660 HTTP/database tests across 27 suites, including 13 new HTL-26 reply cases. The complete application publishes all 110 mandatory API method/path pairs from the official PDF plus the approved review-reply bonus route. The 104 mandatory workbook statements were cross-checked read-only; frontend UI acceptance and the remaining bonuses stay separate.

Start with [backend setup](backend/README.md), [current handoff](backend/docs/M1_BACKEND_HANDOFF.md), [requirement review](backend/docs/M1_REQUIREMENT_REVIEW.md), [Milestone 1 submission checklist](backend/docs/M1_SUBMISSION_CHECKLIST.md) and [reference setup](backend/docs/REFERENCE_DATA.md). The official PDF/workbook define requirements; historical unchecked boxes in the supplied implementation guide describe its November 15 audit. Material assistance is recorded in [AI_PROMPTS.txt](AI_PROMPTS.txt).

Use tested feature branches and reviewed merges into develop. Keep private .env files and credentials out of Git. Frontend and deployment bonuses were not added.

After the mandatory release, the user approved one optional addition: [HTL-26 hotel moderator review replies](backend/docs/HOTEL_REVIEW_REPLIES.md). The assigned moderator can create one hotel response per visible review; public review views include it without exposing moderator identity. Existing ratings, guest edits and moderation are preserved.

Backend CI runs locked installation, typecheck, lint, build, unit tests, offline reference validation and the complete HTTP/database suite on Node 24 with disposable local MongoDB. See the [workflow](.github/workflows/backend-ci.yml) and [actual Actions results](https://github.com/abdullah-hassib/giu-travel-platform/actions/workflows/backend-ci.yml). Genuine Stripe test-mode evidence is recorded separately in [STRIPE_SANDBOX_ACCEPTANCE.md](backend/docs/STRIPE_SANDBOX_ACCEPTANCE.md).

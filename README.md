# GIU Travel Planning and Booking Platform

Milestone 1 backend deadline: November 20, 2026. Milestone 2 frontend deadline: December 11, 2026.

The NestJS/TypeScript backend integrates authentication/users/administration, flight and hotel search/inventory/bookings, policy acceptance/payments/refunds, itineraries/budgets/FX, reviews/blog/community, server media, notifications/audit and official references. The remaining independent backend features are implemented, including flight roster/CSV, private e-ticket PDFs, airline logos and hotel profile/photo audit events. Private Stripe test-mode acceptance and the intended private runtime demonstration remain unverified.

Typecheck, build and lint passed, with 209 unit tests and 647 HTTP/database tests across 27 suites. The running application publishes all 110 mandatory API method/path pairs from the official PDF. The 104 mandatory workbook statements were cross-checked read-only; UI acceptance and optional bonuses remain outside the backend assignment.

Start with [backend setup](backend/README.md), [current handoff](backend/docs/M1_BACKEND_HANDOFF.md), [requirement review](backend/docs/M1_REQUIREMENT_REVIEW.md) and [reference setup](backend/docs/REFERENCE_DATA.md). The official PDF/workbook define requirements; historical unchecked boxes in the supplied implementation guide describe its November 15 audit. Material assistance is recorded in [AI_PROMPTS.txt](AI_PROMPTS.txt).

Use tested feature branches and reviewed merges into develop. Keep private .env files and credentials out of Git. Frontend and deployment bonuses were not added.

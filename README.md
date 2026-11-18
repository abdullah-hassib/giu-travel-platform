# GIU Software Project I — Travel Planning and Booking Platform

Backend Milestone 1 deadline: November 20, 2026. Frontend Milestone 2 deadline: December 11, 2026.

The repository contains **backend/** (NestJS/TypeScript). Authentication/profile, administration accounts/moderators/hotel status/booking reads/action history, itineraries/images/hotel search, budgeting/FX and official reference data are implemented. MK's hotels, bookings, reviews, blog and moderation are integrated with policy/payment/refund services and the hotel deactivation guard. Omar's notifications/audit code is integrated with real account, hotel/provider/moderation and refund events. Adham's submitted flight code needs the reference/assignment reconciliation and missing mandatory APIs described in the flight integration plan; private live Stripe verification also remains pending. The full milestone remains incomplete. See the [current completed-slice handoff](backend/docs/M1_INDEPENDENT_HANDOFF.md) for merged PRs, verification and dependencies.

Start with [backend/README.md](backend/README.md), [implementation status](backend/docs/IMPLEMENTATION_STATUS.md) and [reference-data setup/handoff](backend/docs/REFERENCE_DATA.md). The official GIU PDF and linked Excel workbook define requirements; the four official reference CSV exports are versioned under backend/data/reference. Material AI assistance is tracked in [AI_PROMPTS.txt](AI_PROMPTS.txt).

Git policy: develop feature work from `develop`; review PRs before merging; do not merge unreviewed code to `main`; keep real `.env` files and secrets out of Git.

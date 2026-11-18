# GIU Software Project I — Travel Planning and Booking Platform

Backend Milestone 1 deadline: November 20, 2026. Frontend Milestone 2 deadline: December 11, 2026.

The repository contains **backend/** (NestJS/TypeScript). Implemented areas include authentication/profile, administrator accounts/moderators, itineraries, budgeting/FX and official reference-data seeding/lookup APIs. MK's hotels, bookings, reviews, blog and moderation are integrated with the hotel provider, payment and cancellation/refund services. Flight adapters, notification/audit delivery, remaining itinerary/admin operations and live Stripe verification are still pending. The full milestone remains incomplete.

Start with [backend/README.md](backend/README.md), [implementation status](backend/docs/IMPLEMENTATION_STATUS.md) and [reference-data setup/handoff](backend/docs/REFERENCE_DATA.md). The official GIU PDF and linked Excel workbook define requirements; the four official reference CSV exports are versioned under backend/data/reference. Material AI assistance is tracked in [AI_PROMPTS.txt](AI_PROMPTS.txt).

Git policy: develop feature work from `develop`; review PRs before merging; do not merge unreviewed code to `main`; keep real `.env` files and secrets out of Git.

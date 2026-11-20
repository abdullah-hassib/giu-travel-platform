# Milestone 1 backend submission checklist

November 20, 2026. This is the backend submission, including the separately approved HTL-26 hotel review-reply bonus. The official PDF and Excel workbook remain authoritative. This checklist prepares the deliverables; the instructor's actual upload location and procedure determine submission.

## Included deliverables

- [x] Integrated NestJS/TypeScript backend, MongoDB/Mongoose schemas and Atlas runtime support.
- [x] Server-side authentication, roles, ownership, assignments, validation and booking/payment/inventory consistency.
- [x] Swagger coverage of all 110 mandatory PDF operations, supporting APIs and the approved review-reply bonus.
- [x] README setup, demo order, current handoff, requirement review and feature contracts.
- [x] Four authoritative reference CSVs, licensed PDF fonts and locked dependency manifest.
- [x] Updated AI_PROMPTS.txt and preserved team Git contribution/merge history.

The workbook's 104 mandatory statements were reconciled read-only. Of eleven optional requirements, HTL-26 is included and ten remain excluded. The complete frontend belongs to Milestone 2.

## Verification evidence

The tested application source is the develop release at `8ff44a4` (HTL-26 PR #48). Finalization changes CI/setup/documentation, preserving the application, tests and dependency lockfile.

| Check | Recorded evidence |
| --- | --- |
| Typecheck, build and lint | Passed locally on Node 24.21.0. |
| Unit tests | 209 passed in 18 suites. |
| Complete HTTP/database regression | 660 passed in 27 suites; zero failed/pending cases; exit 0 and matching saved Jest JSON report. |
| Bonus HTL-26 | 13 new actual-module cases plus the existing Swagger check passed. |
| Mandatory API coverage | All 110 method/path pairs and the official PDF checksum verified by the complete AppModule test. |
| Real Stripe test-mode scenarios | Flight confirmation/PDF, signed replay/tamper protection, full provider refund, hotel decline/retry/confirmation/full user refund and unpaid expiry/cancellation/inventory release verified across two explicitly approved isolated runs. Both paid attempts fully refunded; both unpaid intents cancelled; cleanup complete. |
| Running application | HTTP readiness and actual Swagger returned 200 on November 19, with all 110 mandatory operations matching. Start the app again for the evaluation. |
| GitHub CI | The original readiness workflow passed on Node 20 at `0d35fd2`. The final workflow uses Node 24; use the actual PR/Actions checks and final release manifest for its result. A workflow file alone is not a passing test. |

The first combined Stripe run stopped on an inconsistent forced-deadline fixture. Its successful scenarios and the corrected passing unpaid follow-up are distinguished in [STRIPE_SANDBOX_ACCEPTANCE.md](STRIPE_SANDBOX_ACCEPTANCE.md). Standard tests use controlled gateway responses and disposable local databases; genuine external verification is separate. No new Stripe or shared Atlas operation is part of finalization.

[Backend CI](../../.github/workflows/backend-ci.yml) runs `npm ci`, typecheck, lint, build, unit tests, offline reference CSV validation and the complete HTTP/database suite on Ubuntu 22.04 with a disposable MongoDB 8.2.7 replica set. It does not load private `.env`, use shared Atlas or require Stripe credentials. The CI job must pass for the final source before merge. A source ZIP and verification manifest identify the final submitted ref and the exact CI-tested source.

## Source handoff

The GitHub repository preserves contribution history. The final submission tag fixes the reviewed release; use the tag/commit named in the release manifest if later work continues on develop. The source ZIP is created with `git archive` from that committed release. It contains the tracked backend, requirements/reference assets, documentation and prompt log, and excludes private environment files, installed dependencies, compiled output, uploaded user files and `.git`/local worktrees. The companion SHA-256 and manifest allow the archive and source commit to be checked independently.

Keep runtime configuration private and separate from the source handoff. The only environment template shipped is backend/.env.example with placeholders. The archive does not include account passwords or the configured database connection. Follow [backend setup](../README.md) for a fresh installation. No existing .env is overwritten.

## Demonstration and final operator actions

- [ ] Start the designated Atlas cluster and permit the demonstration machine's IP if needed.
- [ ] From backend/, run `npm ci` on a fresh clone, preserve/configure the private environment, then run `npm run start:dev`.
- [ ] Start the normal local Stripe listener: `stripe listen --all-snapshot --forward-to http://localhost:3000/api/payments/webhook`.
- [ ] Open http://localhost:3000/api/docs and check readiness. Use privately provisioned accounts; keep passwords, cookies and client secrets out of screenshots and submitted source.
- [ ] Rehearse administrator/provider/moderator, inventory, traveler hold, policy acceptance, test payment/webhook, booking/PDF, cancellation/refund, notifications/history, itinerary/budget and review-reply demonstrations.
- [ ] Submit the repository/tag link and/or prepared source ZIP using the actual instructor-specified procedure. Source preparation does not claim that the GIU upload has been performed.

HTTPS/browser presentation, optional email/flight changes/seat selection/other bonuses and the Milestone 2 frontend are outside this backend submission. Operational limits such as best-effort media cleanup and audit archive retention are documented in [M1_BACKEND_HANDOFF.md](M1_BACKEND_HANDOFF.md).

# Milestone 1 — submission and verification checklist

**Date:** 20 November 2026 (backend deadline). **Target:** current `develop` branch.
This checklist is a practical handoff, not a new interpretation of the GIU requirements.
Confirm the instructor's required upload format and submission location separately.

## Verified implementation evidence (last recorded local results)

- [x] Authentication, accounts, hotel and flight inventory/bookings, administration, payment/refund logic, itineraries/FX, blog/community, notifications/audit, references and media are integrated on `develop`.
- [x] Source-based requirements review records **104 mandatory workbook statements** and **110 required PDF method/path pairs**; UI-specific behavior is deferred to Milestone 2.
- [x] Most recent documented fresh local verification: typecheck, build, lint, **209 unit tests** and **647 HTTP/database test cases in 27 suites** passed (19 November).
- [x] Official reference seed application was separately approved and verified earlier. Never rerun writes against shared Atlas as a routine CI check.
- [x] `AI_PROMPTS.txt` documents material AI assistance.

The above are **historical local test reports**, not a claim that GitHub CI has already passed or that a genuine Stripe test-mode transaction has run.

## Automatic source verification (new)

The `.github/workflows/backend-ci.yml` workflow checks `develop` pushes and PRs targeting `develop` when backend source or the workflow itself changes. It runs locked npm installation, TypeScript typecheck, lint, build, unit tests, **offline** official CSV validation and all HTTP/database e2e tests on Node 20 / Ubuntu 22.04. The e2e suites create isolated localhost MongoDB replica sets (MongoDB 8.2.7). It does **not** load private `.env`, shared Atlas credentials or Stripe keys.

- [ ] Wait for the first GitHub Actions check to complete successfully. A newly committed workflow is not proof that CI ran or passed.
- [ ] Fix any runner-specific failures; preserve test output and the exact passing commit SHA. If GitHub Actions cannot run, do the identical command sequence locally and record evidence transparently.
- [ ] Confirm the tested SHA is the SHA actually submitted.

From `backend/`, repeat locally if needed:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm run seed:reference
npm run test:e2e
```

`seed:reference` **without `--apply`** validates input only; do not add `--apply` to CI.

## Manual external acceptance — still required

- [ ] **Real Stripe test mode**: using private runtime credentials and the isolated plan in draft PR #46, verify one genuine flight and hotel successful PaymentIntent, SDK-verified webhook, booking confirmation, cancellation, and an authorized refund. Check duplicate delivery, failure/retry and expired hold. Do not use live-mode keys or real cards.
- [ ] Review PR #46's result before marking it accepted. Its existing fixture/plan checks do **not** demonstrate an actual Stripe transaction.
- [ ] **Intended runtime**: launch the real Nest app using approved private configuration and show `/api/health/ready` and `/api/docs`. Show account permissions and relevant hotel/flight workflows without exposing account secrets, tokens or user data.
- [ ] **Secure cookies/browser**: demonstrate the intended HTTPS environment if required for acceptance; simulated production cookie flags in local tests are not a browser demonstration.
- [ ] If any external demonstration cannot be completed by submission, mark it **unverified** in the handoff rather than inventing a result.

## Submission preparation

- [ ] Confirm the current `develop` SHA and check there are no accidental unmerged mandatory fixes.
- [ ] Ensure `backend/.env`, credential-bearing files, uploaded media, `node_modules` and build artifacts are **not** tracked or included in the submission. The committed `.env.example` contains placeholders only.
- [ ] Keep `README.md`, `backend/README.md`, `backend/docs/M1_BACKEND_HANDOFF.md`, `backend/docs/M1_REQUIREMENT_REVIEW.md`, and `AI_PROMPTS.txt` with the source; preserve the required official CSV reference data.
- [ ] Confirm Swagger documents the required APIs, and record a short demo path: admin login / provider / moderator → inventory → traveler hold → policy acceptance → Stripe test confirmation → booking detail → cancellation/refund → notifications/audit.
- [ ] Record the final commit SHA, test command/result, remaining limitations, and who reviewed the handoff.
- [ ] Submit to GIU using the **actual instructor-specified** repository/ZIP/upload procedure. This document does not assert an unverified packaging format or deadline time.

## Explicit scope boundary

The complete Next.js frontend, responsive UI, forms and browser-oriented user journeys belong to **Milestone 2 (11 December 2026)**. They are not implemented on `develop` as of this review; do not mark the whole two-milestone project finished.

**Last evidence and sources:** `backend/docs/M1_BACKEND_HANDOFF.md`, `backend/docs/M1_REQUIREMENT_REVIEW.md`, `backend/docs/IMPLEMENTATION_STATUS.md` and draft [Stripe acceptance PR #46](https://github.com/abdullah-hassib/giu-travel-platform/pull/46).

# Human review / blockers

- [x] Review official GIU 14-page project PDF (copy at `docs/requirements/official-giu-project-description.pdf`).
- [ ] Provide and inspect the Excel requirements workbook and reference CSV datasets (not available).
- [ ] Agree on proposed cross-module contracts and role/state semantics.
- [ ] `npm install` succeeds with network access; commit generated `package-lock.json` after review.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` all pass.
- [ ] Supply private Atlas URI in local `.env` (not in Git), grant Atlas network access, start server and verify live database readiness.
- [ ] Start server and check `http://localhost:3000/api/docs` and `.../api/docs-json`.
- [ ] Review any required security controls and missing Milestone 1 entities against specification before feature work.

Do **not** treat the current authentication slice or other module skeletons as a complete Milestone 1 submission or merge them to `main` without approval.

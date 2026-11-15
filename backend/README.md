# GIU Travel Backend — Milestone 1 work in progress

See [root README](../README.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [contracts requiring approval](docs/CONTRACTS_PROPOSED.md).

## Quick start

```bash
npm install
cp .env.example .env
# Set MONGODB_URI in the new local .env (never commit this file).
npm run typecheck
npm run build
npm run lint
npm test
npm run test:e2e
npm run start:dev
```

Swagger: `http://localhost:3000/api/docs`
Liveness: `http://localhost:3000/api/health/live`
Atlas readiness: `http://localhost:3000/api/health/ready`

Routes implemented in source: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/change-password`, `/api/users/me` (GET, PATCH, DELETE), plus health and Swagger.

`npm run seed:admin` bootstraps an administrator from one-time environment variables. Example on a developer machine (replace the email; enter a strong private password at the prompt):

```bash
export ADMIN_BOOTSTRAP_EMAIL='admin@example.com'
read -rsp 'One-time admin password: ' ADMIN_BOOTSTRAP_PASSWORD; echo
export ADMIN_BOOTSTRAP_PASSWORD
npm run seed:admin
unset ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_PASSWORD
```

Never put credentials into Git, AI chats, or the project ZIP. Run only once after MongoDB credentials are configured. The admin identity and exact password policy still require review against the workbook.

## Important

The official GIU specification PDF has been reviewed, but the exact mandatory rules require the missing Excel workbook and the reference-data CSVs. The current password, lockout, and session defaults are provisional. The npm registry was unavailable in the AI build environment, so no dependency installation, true NestJS build, Jest execution, MongoDB integration or Swagger startup has passed yet. Other modules are still skeletons. **Do not merge this code without human review and successful checks.**

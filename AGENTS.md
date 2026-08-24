# AGENTS.md

Architecture source of truth: `scaffold-spec.md`. Implement it; do not redesign it.

## Stack (decided — do not substitute)
- Node 22, TypeScript strict, npm workspaces
- Postgres 16, two roles: `scaffold_owner` (migrations) and `app_role` (application). Never connect the app as `scaffold_owner`.
- HTTP: Fastify. DB: `pg` (no ORM). Tests: Vitest. UI: React 18 + Vite.
- Migrations: plain `.sql` files run in filename order by `npm run migrate`, tracked in `schema_migration`.

## Setup
- `./scripts/setup-db.sh` creates `scaffold_owner`, `app_role`, and database `tools` on local Postgres (idempotent)
- `cp .env.example .env` — both URLs point at local Postgres with different roles

## Commands
- `npm run migrate` — runs migrations as `scaffold_owner` (`DATABASE_URL_OWNER`)
- `npm run seed` — seeds actors, grants, and app fixtures (`--rows=10000` for load)
- `npm test` — runs Vitest against the local DB as `app_role` (`DATABASE_URL`)
- `npm run dev -w apps/<name>` — starts an app

## Layout
- `scaffold/` — `withActor`, `route`, `authorize`, dev identity, migration runner, shared tests
- `migrations/` — all SQL. Numbering: scaffold `0001–0099`, KYC `0100–0199`, refunds `0200–0299`. Never renumber.
- `apps/kyc/`, `apps/refunds/` — one app each: `server/`, `ui/`, `README.md`
- `.github/workflows/ci.yml` — migrate + test against a Postgres service

## Rules
- Every app table's migration attaches the `audit` trigger **and** grants `SELECT, INSERT, UPDATE, DELETE` on the table to `app_role`. A "permission denied" error is never solved by changing which role connects.
- Every route goes through `route()`. Do not import Fastify's router in app code.
- `requested_by` / `decided_by` come from the session actor, never the request body.
- If a task seems to require changing scaffold migrations, trigger functions, roles, `withActor`, `route`, or CI: stop and say so in the PR instead of doing it.

## PRs
- Branch from `main`, one PR per session, conventional commit messages.
- PR description lists each spec acceptance criterion with how it was verified.
- Do not disable, skip, or loosen a test to make CI pass; flag it instead.

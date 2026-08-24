# internal-tools-scaffold

A prototype built with Devin to answer one question for a fintech engineering team weighing Power Apps against building in-house: **can many internal tools share one governance layer — one audit trail, one permission model, one separation-of-duties rule — enforced by the database rather than by convention, with Devin doing the building?**

It contains a small scaffold (four tables, two triggers, two helpers) and two apps built on it in separate Devin sessions from a one-sentence prompt each: a KYC review queue and a refunds dashboard. The interesting output is not the apps; it is whether they came out structurally identical, and what each one cost.

- `scaffold-spec.md` — the architectural contract (human-written; Devin implements, does not redesign)
- `verification-addendum.md` — what gets measured and how
- `reports/` — per-session reports and governance JSON, committed by the session that produced them
- `AGENTS.md` — instructions for Devin

## Running

Node 22 and a local Postgres 16 are the only prerequisites.

```
./scripts/setup-db.sh        # creates roles scaffold_owner + app_role and database tools
cp .env.example .env
npm install
npm run migrate              # as scaffold_owner (DATABASE_URL_OWNER)
npm run seed                 # actors, grants, and app fixtures (default 50 rows)
npm run seed -- --rows=10000 # seed the refunds load fixture
npm test                     # Vitest as app_role; writes reports/junit/<session>.xml
npm run typecheck
npm run governance-report    # writes reports/governance/<app>.json (verification-addendum.md §A)
npm run tamper-check         # proves the two CI guardrails fire; see below
npm run dev -w apps/<name>   # starts an app (app sessions add these)
```

For the refunds dashboard, run `npm run dev -w apps/refunds` and open
`http://localhost:5173`. The API listens on port 3000 and Vite proxies `/refunds`
to it. The top-bar actor switcher writes the `dev_actor` cookie and reloads the
page; it can also be set manually with `curl -b 'dev_actor=bob' ...`.

`npm test` writes `reports/junit/session-1b.xml` by default; set `SESSION=<id>` to change the
filename. Every test name begins with the acceptance-criterion id it covers (`SC-2 …`), which is how
`reports/junit/*.xml` maps to the criteria in `scaffold-spec.md`.

### Switching dev actors

Identity is a header or cookie in development, and nothing else — the middleware that reads them is
registered only when `NODE_ENV=development`:

```
curl -H 'X-Dev-Actor: alice' localhost:3000/...      # reviewer: read, write, approve
curl -H 'X-Dev-Actor: carol' localhost:3000/...      # agent: read, write — approve is denied
curl -b 'dev_actor=bob'      localhost:3000/...      # the cookie the UI switcher sets
```

Requests with no dev actor get `401`; an action with no matching `permission_grant` gets `403`.

### What CI enforces

`.github/workflows/ci.yml` runs the migrations, the seed and the suite against a Postgres 16 service,
then uploads the junit report. Two of those tests are the guardrails:

- `all_app_tables_are_audited` — queries `pg_trigger` for every table in `public` except the
  scaffold's own and `schema_migration`, and fails on any table without the `audit` trigger.
- `all_routes_are_registered` — compares the framework's route table with the registry `route()`
  keeps, and fails on any route that skipped `authorize()`.

`npm run tamper-check` is the same two checks run against a real trigger-less table and a real
bypassing route, so the guardrails themselves are demonstrably alive (verification-addendum.md §F,
violations 1 and 2).

### Writing an app on the scaffold

```ts
import { createServer } from "@scaffold/core";

export function createApp() {
  const server = createServer({ app: "kyc" });
  server.route(
    { method: "GET", path: "/cases", action: "read", resourceType: "kyc_case" },
    async ({ tx }) => (await tx.query("SELECT id FROM kyc_case ORDER BY submitted_at DESC LIMIT 50")).rows,
  );
  return server;
}
```

`route()` resolves the actor, opens the transaction with `withActor()` and calls `authorize()` before
the handler; the handler receives that transaction as `tx`. The scaffold exports no framework router,
so there is no other way to add a route. `apps/<name>/server/app.ts` exporting `createApp()` is also
how `npm run governance-report` discovers an app; until an app exists it reports on the scaffold's own
demo server (`reports/governance/scaffold.json`).

The root seed discovers each `apps/*/server/seed.ts` module after seeding actors
and grants. Refund fixtures are inserted through `withActor()` as `app_role`,
so their audit rows are real. Seeding is idempotent when the table already has
at least the requested number of rows.

## Known limitations

Stated here on purpose, not buried:

- Row-level filtering is done in the application query builder, not Postgres RLS. Production should use RLS; the two-role split and `SET LOCAL app.actor_id` are the foundation it would key on.
- Identity in this prototype is a dev-mode actor switcher (`X-Dev-Actor`), registered only when `NODE_ENV=development`. Production replaces it with OIDC middleware producing the same `actor` object.
- A test that quietly connects as `scaffold_owner` has no structural guard. It is caught by reading commit history, not by CI. See the tamper check in `verification-addendum.md`. `npm run tamper-check` is itself the one place that uses `DATABASE_URL_OWNER` outside migrations and the seed, because creating a trigger-less table requires it; the guardrail it exercises then runs as `app_role`.
- `NODE_ENV` is read after `dotenv` loads `.env`, so an *unset* `NODE_ENV` plus a `.env` containing `NODE_ENV=development` (which `.env.example` does) enables the dev actor switcher. An explicitly set `NODE_ENV` always wins, so `NODE_ENV=production` is inert whatever `.env` says; a deployment that ships a `.env` should set `NODE_ENV` explicitly.
- The demo route `POST /fixtures/:id/approvals` does not check that the resource exists or that an approval is unique per resource — `approval.resource_id` is `text` by design. App sessions own that validation for their own tables.
- `all_app_tables_are_audited` proves the trigger is attached, not that a migration cannot drop it afterwards. A Postgres event trigger rejecting `DROP TRIGGER` on `audit` would close that gap and is not implemented here.

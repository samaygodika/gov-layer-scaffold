# Session report — `1b`

Scope of this session, as instructed: the application layer of the scaffold — `withActor()`,
`route()`, `authorize()`, dev-mode identity, the two CI guardrails and their negative cases,
`npm run governance-report`, `.github/workflows/ci.yml`, README run instructions, and the SC-1
loosening in `scaffold/tests/migrations.test.ts`. No app tables and no UI: `apps/kyc` and
`apps/refunds` remain for the app sessions. The database layer from session 1a was not modified —
no migration was added, edited or renumbered.

## 1. Acceptance criteria

| id | criterion | status | test file::name | evidence |
|---|---|---|---|---|
| SC-1 | Migrations run clean on an empty database as `scaffold_owner`; the public schema contains the scaffold tables (loosened from "exactly" to "at least", as instructed) | pass | `scaffold/tests/migrations.test.ts::SC-1 every migration is applied and recorded in schema_migration`, `::SC-1 trigger functions are SECURITY DEFINER and owned by scaffold_owner` | `npm run migrate && npm test` → `✓ scaffold/tests/migrations.test.ts (2 tests)`; the table assertion is now `expect.arrayContaining([…6 scaffold tables])` |
| SC-2 | As `app_role`: INSERT, UPDATE and DELETE on `audit_event` all fail | pass (1a, re-run) | `scaffold/tests/audit-event-grants.test.ts::SC-2 …` (4 tests) | `npm test` → `✓ scaffold/tests/audit-event-grants.test.ts (4 tests)` |
| SC-3 | Inserting an `approval` with `decided_by = requested_by` is rejected | pass (1a, re-run) | `scaffold/tests/approval.test.ts::SC-3 …` | `npm test` → `✓ scaffold/tests/approval.test.ts (9 tests)` |
| SC-4 | `requested_by` / `decided_by` must equal `app.actor_id` | pass (1a, re-run) | `scaffold/tests/approval.test.ts::SC-4 …` | same run. The demo route `POST /fixtures/:id/approvals` takes `requested_by` from `ctx.actor.id`, never from the body |
| SC-5 | Setting `decision` without `rationale` is rejected | pass (1a, re-run) | `scaffold/tests/approval.test.ts::SC-5 …` | same run |
| SC-6 | An UPDATE inside an actor transaction produces exactly one `audit_event` with correct `before`, `after`, `actor_id`, `request_id`, `app` — now through `withActor()` rather than hand-written `set_config` | pass | `scaffold/tests/with-actor.test.ts::SC-6 carries the actor, request id and app into the transaction`, `::SC-6 a mutation inside withActor() is committed and audited`, `::SC-6 rolls back and rethrows when the callback fails` | `npm test` → `✓ scaffold/tests/with-actor.test.ts (3 tests)`; the audit row reads `{actor_id: alice, app: "scaffold", request_id: "req-with-actor"}`, and the rollback case leaves zero rows and rethrows the original error |
| SC-7 | The same UPDATE with no `app.actor_id` fails with the trigger's error | pass (1a, re-run) | `scaffold/tests/audit-trigger.test.ts::SC-7 a mutation with no app.actor_id fails and changes no row` | `npm test` → `✓ scaffold/tests/audit-trigger.test.ts (3 tests)` |
| SC-8 | `all_app_tables_are_audited` passes, and fails for a trigger-less table | pass | `scaffold/tests/app-tables-audited.test.ts::SC-8 every app table in public has the audit trigger`, `::SC-8 the check looks at pg_trigger, and the scaffold's audited tables are found there`, `::SC-8 the check ignores the scaffold's own tables and the migration ledger`, `::SC-8 the check fails when a table has no audit trigger` | `npm test` → `✓ scaffold/tests/app-tables-audited.test.ts (4 tests)`. The negative case is also run against a *real* trigger-less table: `npm run tamper-check` → `caught all_app_tables_are_audited: tables without the audit trigger: _tamper_no_audit` |
| SC-9 | `authorize()` denies when no matching `permission_grant` exists | pass | `scaffold/tests/authorize.test.ts::SC-9 …` (4 tests), `scaffold/tests/routes.test.ts::SC-9 route() denies by default: an agent may not approve`, `::SC-9 route() refuses a request with no identity before opening a transaction` | `npm test` → `✓ scaffold/tests/authorize.test.ts (4 tests)`, `✓ scaffold/tests/routes.test.ts (4 tests)`; carol (`agent`) gets `403 actor carol may not approve _scaffold_fixture`, no identity gets `401` |
| SC-10 | `all_routes_are_registered` passes, and fails for a directly-registered route | pass | `scaffold/tests/routes.test.ts::SC-10 all_routes_are_registered passes when every route went through route()`, `::SC-10 all_routes_are_registered fails when a route is registered on the framework directly` | `npm test`; the bypass case asserts `routesOutsideRegistry() === [{method: "GET", path: "/bypass"}]` and the thrown `routes registered outside route(): GET /bypass`. Also run for real: `npm run tamper-check` → `caught all_routes_are_registered: routes registered outside route(): GET /bypass` |
| SC-11 | Dev actor switcher works in development, absent in production | pass | `scaffold/tests/dev-identity.test.ts::SC-11 in development the X-Dev-Actor header selects the actor`, `::SC-11 in development the dev_actor cookie selects the actor, and the write is attributed to them`, `::SC-11 an unknown dev actor is not an identity`, `::SC-11 outside development the middleware is not registered and the header is inert`, `::SC-11 in production identity comes from the injected provider instead` | `npm test` → `✓ scaffold/tests/dev-identity.test.ts (5 tests)`. With `NODE_ENV=production` and with `NODE_ENV=test`, `hooks()` does not contain `dev-identity` and `X-Dev-Actor: alice` gets `401` |
| SC-12 | The scaffold exports no UI components | pass | `scaffold/tests/scaffold-exports.test.ts::SC-12 contains no UI source files`, `::SC-12 depends on no UI package`, `::SC-12 exports no component and no framework router` | `npm test` → `✓ scaffold/tests/scaffold-exports.test.ts (3 tests)`; no `.tsx/.jsx/.css/.scss/.svg/.html` under `scaffold/`, no react/vite dependency, and `scaffold/src/index.ts` exports no `FastifyInstance` and no `unsafeRawServer` |
| SC-13 | `npm run governance-report` writes `reports/governance/<app>.json` | pass | `scaffold/tests/governance-report.test.ts::SC-13 writes reports/governance/<app>.json in the addendum's shape`, `::SC-13 the same database and registry produce byte-identical output` | `npm run governance-report` → `wrote reports/governance/scaffold.json: 1 table(s), 3 route(s), 0 outside the registry`; output pasted in §9 |
| SC-14 | `reports/session-<id>.md` filled from `reports/TEMPLATE.md` and committed in the PR | pass | — | This file, committed in the same PR |

Full run: `npm test` → `Test Files 11 passed (11)`, `Tests 43 passed (43)`, junit at
`reports/junit/session-1b.xml`. `npm run typecheck` → clean.

## 2. Decisions I made that the spec did not

- **`authorize(client, actor, action, resourceType)` takes the transaction as its first argument**,
  not just the actor. Grants live in `permission_grant`, so the check is a query; running it on the
  same transaction `route()` opened means authorization and the handler see one snapshot and one
  `SET LOCAL` context. The spec's `authorize(actor, action, resourceType)` signature is preserved in
  spirit — the client is plumbing supplied by `route()`, not something app code passes.
- **The handler signature is one context object**, `{ tx, actor, requestId, app, params, query, body,
  request, reply }`, rather than `(request, reply)`. It makes `tx` and `actor` impossible to miss and
  keeps app code from reaching for a second connection.
- **Framework routes are collected via Fastify's `onRoute` hook**, so `all_routes_are_registered`
  compares what the framework actually holds against the registry, rather than trusting a wrapper.
  A route added by a plugin, a static-file handler or a stray `instance.get()` all show up.
- **The Fastify instance is kept in a module-private `WeakMap`** (`scaffold/src/internal/raw.ts`)
  instead of a property on the returned server, so there is no public path from a `ScaffoldServer` to
  `.get()/.post()`. The deliberate bypass test reaches it through `scaffold/src/unsafe-raw-server.ts`,
  which is *not* re-exported from `scaffold/src/index.ts` — the only way to bypass `route()` is to
  import a file whose name says so, and CI catches it anyway.
- **`withActor()` uses `set_config(name, value, true)` rather than literal `SET LOCAL`**, because
  `SET LOCAL` takes no bind parameters and interpolating an actor id into SQL is exactly the habit
  this scaffold should not teach. It is the same transaction-local setting.
- **Dev identity resolves through the same `actor` table lookup as production**, keyed on
  `external_subject`, and an unknown or inactive subject yields no identity (`401`) rather than a
  synthetic actor. So a dev request cannot invent an actor id the audit trail cannot explain.
- **`401` for no identity, `403` for a denied action**, with the actor, action and resource named in
  the 403 body.
- **The dev-identity middleware is registered at `createServer()` time**, guarded by
  `NODE_ENV === "development"` read at that moment. Not a per-request check — the hook is either in
  the server's hook list or it does not exist, which is what the SC-11 negative test asserts.
- **`app.request_id`** comes from the incoming `x-request-id` header when present, else Fastify's own
  request id, so a caller's trace id survives into `audit_event`.
- **`_scaffold_fixture` is excluded from `all_app_tables_are_audited`** (alongside `actor`,
  `permission_grant`, `audit_event`, `approval`, `schema_migration`) because it is a test fixture,
  not an app table. It carries the trigger regardless, and the exclusion list is asserted by its own
  test so the next session cannot quietly add a table to it.
- **A demo server** (`scaffold/src/demo-server.ts`, three routes over `_scaffold_fixture`) exists so
  `route()`, `authorize()`, dev identity and the governance report are exercised end to end before
  any app exists. `npm run governance-report` falls back to it when `apps/*/server/app.ts` is absent.
- **`npm run tamper-check`** was added beyond the spec: it performs violations 1 and 2 of
  `verification-addendum.md` §F for real — creates a trigger-less table, registers a bypassing route,
  and asserts both guardrails fire — and runs in CI. The in-suite negative tests assert on the pure
  functions; this one proves the wiring.
- **CI also fails if `reports/governance/*.json` differs from a fresh run**, which is what makes the
  report's determinism (SC-13's second test) load-bearing rather than decorative.
- **`npm test` writes `reports/junit/${SESSION:-session-1b}.xml`**, so each session's junit lands
  under its own name without editing `package.json` again.

## 3. Ambiguities and questions

- **`authorize()`'s signature versus its data source.** The spec writes
  `authorize(actor, action, resourceType)` but puts the grants in a table. Either it queries (needs a
  connection) or grants are cached in the actor. I chose to query on the caller's transaction, and I
  would have asked whether a per-request cache is wanted; with three actors it does not matter, at
  10k grants it would.
- **Whether `route()` should open a transaction for reads.** Everything, including `GET`, currently
  runs inside `withActor()`. It costs a `BEGIN`/`COMMIT` on read paths but means a handler can never
  find itself outside the actor context. I assumed uniformity is worth more than the round trip; a
  read-only variant is a small change if not.
- **Whether the response should be the handler's return value.** The spec is silent, so handlers
  return data and `route()` serialises it, with `reply` available for anything else (status codes,
  streams). An app session may want an envelope (`{data, meta}`) instead; nothing here prevents it.
- **What `tables` in the governance report means for the scaffold itself.** §A asks for the app's
  tables. The scaffold has no app tables, so `reports/governance/scaffold.json` lists only
  `_scaffold_fixture` (the tables the demo server touches), while `app_role_grants` also shows
  `approval` and `audit_event` because that is what an app inherits. I assumed the app sessions'
  reports are the ones that matter and this one is a shape check.
- **Whether `audit_actions_seen` should be scoped to the app.** I scoped it to
  `audit_event.app = <app>`, which makes it a function of the data in the database at report time —
  the honest reading of "actions seen", but it does mean the report is not reproducible on an empty
  database. Flagged because CI diffs the file.
- **Where the dev cookie is set.** The spec names `X-Dev-Actor` and "cookie"; I read the cookie
  `dev_actor` and parse it directly rather than adding `@fastify/cookie` for one string. Whoever
  builds the actor switcher UI will want to know the name.
- **`NODE_ENV` in CI.** Left unset (so the dev hook is absent) while the tests that need
  `development` set it themselves per server. If CI is ever run with `NODE_ENV=development` the
  SC-11 negative test still passes, because it sets the variable explicitly for its own server.

## 4. Things I wanted to change but did not

- **`package.json`'s `test` script and `vitest.config.ts` are scaffold config, and I edited both** —
  the junit filename now takes `SESSION`, and a setup file closes the shared pool after each file.
  Flagging it here per `AGENTS.md`; both are this session's own deliverables (junit upload, a
  connection pool that did not exist before), not workarounds for a failing test.
- **`scaffold/src/seed-data.ts` gained one line**: `_scaffold_fixture` in the resource types that get
  `reviewer`/`agent` grants. Without it no route over the fixture table can be authorized, so SC-9's
  positive case and the demo server would have had nothing to permit. It adds grants for a fixture,
  it does not widen any app's permissions. This is a seed change, not a migration change.
- **I wanted an event trigger forbidding `DROP TRIGGER audit`**, so a later migration could not
  remove an audit trigger that `all_app_tables_are_audited` had already accepted. That is a scaffold
  migration and a trigger function, so per `AGENTS.md` I stopped and noted it here and in the
  README's limitations instead.
- **I wanted a structural guard against a test connecting as `scaffold_owner`.** The only honest one
  is refusing to let `DATABASE_URL_OWNER` into the test environment at all, which would break the
  migration test. Left as 1a left it: caught by review, not CI. `npm run tamper-check` is the single
  place outside migrations/seed that uses the owner URL, and it does so only to create the
  trigger-less table.
- **Nothing in `migrations/`, the trigger functions or the roles was touched.**

## 5. Dependencies added

- `fastify` (`^5.2.0`, resolved 5.12.1) — the HTTP framework `AGENTS.md` mandates; `route()` and the
  dev-identity hook are built on it. Its `inject()` is also how the route tests drive requests
  without binding a port.

No dev dependencies added; `pg`, `tsx`, `vitest` and `typescript` were already present.

## 6. Tests I disabled, skipped, or weakened

One, as explicitly instructed: **SC-1's table assertion in
`scaffold/tests/migrations.test.ts`** changed from `toEqual([…])` to
`toEqual(expect.arrayContaining([…]))`, so app tables added in later sessions do not break it. The
six scaffold tables are still all required to be present. Nothing else was weakened, and no test is
skipped: 43 of 43 run.

## 7. Knowledge and context used

Knowledge notes, all read before writing code:

- **"Routes go through route()"** — confirmed `route({method, path, action, resourceType}, handler)`
  as the only registration path, that it calls `authorize()`, and that deny-by-default is the rule.
  Drove hiding the Fastify instance in a `WeakMap`.
- **"Audit is a trigger, not code"** — no `audit_event` write exists anywhere in the application
  layer; `withActor()` only sets the three settings and the trigger does the rest.
- **"Separation of duties"** — `requested_by` in the demo approval route comes from
  `ctx.actor.id`; the request body is not consulted for identity.
- **"Non-goals"** — says not to modify scaffold `withActor`/`route`/CI. This session's instructions
  are to *write* them, so the note reads as "app sessions must not change them". Where I did touch
  shared config (`package.json`, `vitest.config.ts`, the seed) it is itemised in §4.

Files read before writing code: `AGENTS.md`, `scaffold-spec.md`, `verification-addendum.md`,
`README.md`, `reports/TEMPLATE.md`, `reports/session-1a.md`, `.env.example`, `package.json`,
`tsconfig.json`, `vitest.config.ts`, `scripts/setup-db.sh`, all of `migrations/*.sql`, and all of
`scaffold/src/` and `scaffold/tests/` as session 1a left them.

## 8. Timeline

Approximate, in order:

- reading (`AGENTS.md`, spec, addendum, 1a's report, 1a's code and migrations) — 20 min
- planning the module split and the two guardrails — 10 min
- `withActor`, actor lookup, `authorize` — 20 min
- `route()`, the registry, `createServer`, dev identity — 35 min
- guardrails (`checks.ts`), governance report, tamper check, demo server — 35 min
- tests (SC-6, 8, 9, 10, 11, 12, 13) and the SC-1 loosening — 40 min
- debugging and typecheck — 15 min (three type errors: `pg.Pool` is not a `ClientBase`, which is why
  `Queryable` in `scaffold/src/db.ts` exists; an untyped Fastify error handler; `ready()` returning a
  `PromiseLike`)
- CI workflow, README, this report, PR — 25 min

Nothing had to be redone. The `WeakMap`/`unsafe-raw-server.ts` arrangement was the second design for
the bypass test; the first exposed the instance as a property, which SC-12 rightly disliked.

## 9. Governance report

`npm run governance-report` → `wrote reports/governance/scaffold.json: 1 table(s), 3 route(s), 0
outside the registry`:

```json
{
  "app": "scaffold",
  "tables": [
    {
      "name": "_scaffold_fixture",
      "pk": "id:uuid",
      "audit_trigger": true
    }
  ],
  "audit_event_shape": [
    "id",
    "occurred_at",
    "actor_id",
    "app",
    "action",
    "resource_type",
    "resource_id",
    "before",
    "after",
    "request_id"
  ],
  "audit_actions_seen": [
    "delete",
    "insert"
  ],
  "approval_constraints": [
    "approval_actor_matches",
    "approval_decision_has_decider",
    "approval_decision_has_rationale",
    "approval_decision_vocabulary",
    "approval_maker_checker"
  ],
  "app_role_grants": {
    "_scaffold_fixture": [
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE"
    ],
    "approval": [
      "INSERT",
      "SELECT",
      "UPDATE"
    ],
    "audit_event": [
      "SELECT"
    ]
  },
  "routes": [
    {
      "method": "GET",
      "path": "/fixtures",
      "action": "read",
      "resourceType": "_scaffold_fixture"
    },
    {
      "method": "POST",
      "path": "/fixtures",
      "action": "write",
      "resourceType": "_scaffold_fixture"
    },
    {
      "method": "POST",
      "path": "/fixtures/:id/approvals",
      "action": "approve",
      "resourceType": "_scaffold_fixture"
    }
  ],
  "routes_outside_registry": []
}
```

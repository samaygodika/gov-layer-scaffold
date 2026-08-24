# Session report — `2` (app: kyc)

Scope: `apps/kyc` — the KYC review queue — on the scaffold from sessions 1a/1b. One migration
(`migrations/0100_kyc_case.sql`), a server whose every route is `route()`, a React/Vite UI, tests
`AC-1 … AC-9`, `reports/governance/kyc.json`, and this file. No scaffold migration, trigger
function, role, `withActor()`, `route()` or CI file was edited; the app writes no `audit_event` row
and holds no permission logic of its own.

## 1. Acceptance criteria

| id | criterion | status | test file::name | evidence |
|---|---|---|---|---|
| AC-1 | The migration that creates the app table attaches the `audit` trigger (CI proves it) | pass | `apps/kyc/tests/kyc-table.test.ts::AC-1 has the audit trigger, so all_app_tables_are_audited passes`, `::AC-1 grants app_role exactly the DML the application needs`, `::AC-1 a case update inside an actor transaction produces one audit_event with the diff`, `::AC-1 a case update with no actor in the transaction is refused by the trigger` | `npm test` → `✓ apps/kyc/tests/kyc-table.test.ts (4 tests)`; `unauditedTables()` is `[]` with `kyc_case` present, grants are exactly `DELETE, INSERT, SELECT, UPDATE`, and the no-actor update fails with `app.actor_id is not set` |
| AC-2 | Every route is defined via `route()`; `all_routes_are_registered` passes | pass | `apps/kyc/tests/kyc-routes.test.ts::AC-2 every route is declared through route(), so all_routes_are_registered passes`, `::AC-2 authorization is the choke point: no identity is 401, an agent may not decide` | `npm test` → `✓ apps/kyc/tests/kyc-routes.test.ts`; `routesOutsideRegistry()` is `[]` for the ready server, anonymous `GET /api/cases` is `401`, and carol (`agent`) posting a decision is `403 actor carol may not approve kyc_case`. Also `npm run governance-report` → `5 route(s), 0 outside the registry` |
| AC-3 | Approve/reject writes an `approval` row with `decided_by` taken from the session actor | pass | `apps/kyc/tests/kyc-routes.test.ts::AC-3 requested_by and decided_by come from the session actor, not the request body` | `npm test`; bob opens the review and alice decides while *both* request bodies name the other actor, and the stored row is `{requested_by: bob, decided_by: alice, decision: approved, rationale: "documents match the subject"}` |
| AC-4 | Self-approval is refused **through the UI**: request as bob, approve as bob, observe the error; approve as alice, observe success | pass | `apps/kyc/tests/kyc-routes.test.ts::AC-4 the reviewer who opened the review cannot decide it; a second reviewer can`, `::AC-4 a decision with no rationale is refused` | `npm test`; bob's own decision is `409 … violates check constraint "approval_maker_checker"` and the case is still `pending`, then alice's is `200 {case:{status:"approved"}}`. The through-the-UI half of the criterion was walked in the browser with the dev actor switcher — recording linked from the PR |
| AC-5 | Detail page shows the audit history including the successful decision's diff | pass | `apps/kyc/tests/kyc-routes.test.ts::AC-5 the detail response carries the audit history including the decision's diff` | `npm test`; `GET /api/cases/:id` returns four entries — `insert kyc_case by alice@example.com`, `insert approval by bob@example.com`, `update approval by alice@example.com`, `update kyc_case by alice@example.com` — the approval diff going `decision: null → "rejected"`, `decided_by: null → alice`, and the case diff `status: pending → rejected`. The UI renders the same rows with actor, time, action, request id and the changed keys |
| AC-6 | List paginates server-side; verified with 10,000 seeded rows | pass | `apps/kyc/tests/kyc-routes.test.ts::AC-6 the list is paginated server-side: one page of 50, filters applied in SQL`, `::AC-6 pagination holds at 10,000 rows: page 200 is the last, and each page costs one query` | `npm run seed -- --rows=10000` → `kyc: seeded 9976 pending kyc_case rows (10000 total)`; the test inserts 10,000 rows and asserts `total: 10000`, 50 rows on page 1, 50 on page 200, `[]` on page 201, and that `EXPLAIN` of the list query carries a `Limit` node — the application never receives more than a page |
| AC-7 | README documents how to run, seed, and switch dev actors | pass | `apps/kyc/tests/kyc-artifacts.test.ts::AC-7 the README documents how to run, seed and switch dev actors` | `apps/kyc/README.md`: `npm run dev -w apps/kyc`, `npm run seed -- --rows=10000`, the actor/permission table, and the maker-checker curl transcript |
| AC-8 | `reports/governance/<app>.json` is generated and committed | pass | `apps/kyc/tests/kyc-artifacts.test.ts::AC-8 reports/governance/kyc.json is committed and describes this app` | `npm run governance-report` → `wrote reports/governance/kyc.json: 1 table(s), 5 route(s), 0 outside the registry`; pasted in §9 |
| AC-9 | `reports/session-<id>.md` is filled and committed in the PR | pass | `apps/kyc/tests/kyc-artifacts.test.ts::AC-9 reports/session-2.md is filled from the template` | This file, committed in the same PR; the test compares its `##` headings against `reports/TEMPLATE.md` |

Full run: `SESSION=session-2 npm test` → `Test Files 14 passed (14)`, `Tests 58 passed (58)`, junit at
`reports/junit/session-2.xml`. `npm run typecheck` → clean.

One scaffold test had to be adjusted for a second table to exist at all; see §6.

## 2. Decisions I made that the spec did not

- **Opening a review is an explicit step, `POST /api/cases/:id/review-requests`.** The spec says a
  decision needs an `approval` row, and the scaffold's `approval` row is created by the requester and
  updated by the decider. Cases arrive from upstream with nobody as requester, so somebody has to be
  the maker: the first reviewer to pick a case up. This is what makes AC-4 reachable through the UI —
  bob requests, bob is refused, alice succeeds.
- **`action: "write"` for opening a review, `action: "approve"` for deciding.** So carol (`agent`) can
  triage the queue but cannot decide, which is the distinction the seeded grants draw.
- **Page size 50, page number in `?page=`, no cursor.** The spec fixes 50 and newest-first; offset
  paging keeps "page 200 of 200" expressible, which is what a reviewer scanning a 10,000-case backlog
  actually clicks. The index is `(submitted_at DESC, id DESC)` and the tie-break on `id` keeps the
  order total, so no row can be skipped or repeated across pages.
- **The database's refusal is surfaced as `409` with its own message text**, unmodified, for
  Postgres codes `23514` (CHECK) and `P0001` (a trigger's `RAISE`). The reviewer sees
  `violates check constraint "approval_maker_checker"`. Ugly, and deliberately so: it is evidence the
  rule is where the spec says it is. Nothing in this app pre-checks the rule and returns a friendlier
  message — a pre-check that drifted from the constraint would be worse than the raw text.
- **The UI's buttons come from a `can` block on the API response**, computed with the scaffold's
  `isAuthorized()` — the same grant lookup `route()` performs. Rendering is the only thing it drives;
  authorization still happens in `route()`, so hiding a button is a courtesy, not a control.
- **`GET /api/me` exists** so the switcher can name the current actor and its capabilities without
  guessing from a cookie.
- **The audit timeline on the detail page includes the case's `approval` rows' events**, not just
  `kyc_case`'s. The decision *is* the approval update; a timeline showing only the status change would
  hide who decided and why.
- **Seeded cases are all `pending` and attributed to carol** with `request_id = 'seed'`. A seeded
  `approved` case would need an `approval` row with two actors behind it — a state the app cannot
  produce, so the fixtures do not invent one.
- **`npm run seed` discovers `apps/<name>/server/seed.ts`** and passes `--rows=N` through; the app
  seed tops the table up to the target rather than duplicating on re-run. `scaffold/src/seed.ts` grew
  that discovery loop — additive, and the actor/grant seeding it already did is untouched.
- **No `DELETE` route**, though the migration grants `DELETE` on `kyc_case` as AGENTS.md requires.
  Upstream owns case existence.

## 3. Ambiguities and questions

- **Who is the "maker" for a case that arrives from upstream?** The spec's AC-4 says "create/request
  as bob", but the KYC app has no create screen — the two halves of that sentence cannot both be
  literal here. I assumed the maker is the reviewer who opens the review, and made that an explicit
  route so the maker-checker pair is bob→alice rather than upstream→bob. The alternative reading —
  seed an `approval` per pending case attributed to the upstream feed — would make every case
  decidable by any reviewer *except* carol, and would put a fake requester in the audit trail.
- **May a rejected or approved case be reopened?** Nothing in the spec says. I made the status
  transition one-way: `review-requests` refuses a case that is not `pending`. Reopening would need a
  second approval row per case and a story about which one is current.
- **One pending review per case, or several?** I allowed only one; a second `POST` while a review is
  open is `409`. Concurrent reviews would leave the "which approval does this decision belong to"
  question to whoever clicks first.
- **Is `approve` a distinct action from `reject`?** The scaffold has one `approve` action and
  `approval.decision` carries `approved`/`rejected`, so a reviewer who may approve may also reject.
  A shop that wanted a separate reject grant would need a new action in the scaffold, which this
  session may not add.
- **Should the rationale be required for `approved` as well as `rejected`?** The database requires
  one for any decision (`approval_decision_has_rationale`), so the UI requires one for both. I did
  not add a length or content rule.
- **What should the audit timeline show for `documents`?** A JSONB blob's before/after is long. I
  render the changed keys with their values and let the row expand, rather than diffing inside the
  JSON.
- **How large is "10,000 seeded rows" meant to be in CI?** Seeding 10,000 rows on every CI run costs
  time for a criterion about SQL, so the load case builds its 10,000 rows inside a rolled-back
  transaction in the test, and `npm run seed -- --rows=10000` is the documented way to get the same
  data in front of the UI. Both are recorded above.
- **Whether `apps/kyc` should own a `tsconfig`.** I extended the root one (`DOM` lib, `jsx`,
  `apps/**/*.tsx`) instead, so `npm run typecheck` covers the UI in one pass. A per-app config would
  be cleaner if the two apps ever disagree about `lib`.

## 4. Things I wanted to change but did not

- **`scaffold/tests/app-tables-audited.test.ts` asserts the exact list of audited tables**
  (`["_scaffold_fixture", "approval"]`). That assertion cannot survive any app session: the first app
  table added makes it fail, which is what happened here with `kyc_case`. It is the same shape of
  problem as SC-1's "exactly the scaffold tables", which session 1b was instructed to loosen. See
  §6 — I changed it to `arrayContaining` and flagged it rather than leaving CI red, but the scaffold's
  own test is the thing that wanted changing, and I would rather a human confirmed it.
- **`approval` has no foreign key to the resource it approves** (it is `resource_type` +
  `resource_id`), so nothing at the database level stops an `approval` naming a `kyc_case` that does
  not exist, and `kyc_case.status` and `approval.decision` can in principle disagree. The app writes
  both in one `withActor()` transaction, so they cannot diverge through this code path. A
  per-resource FK or a trigger keeping the two in step would need a scaffold change; the polymorphic
  table is clearly deliberate, so I left it.
- **`documents` is `jsonb` with no shape.** I wanted a CHECK that it is an array of
  `{kind, ref}` objects, but the spec names the column `documents JSONB` and nothing more, and
  guessing an upstream feed's document shape into a constraint would be the app dictating to its
  producer. The migration only guarantees it is an array.

## 5. Dependencies added

All in `apps/kyc/package.json`; the root manifest gained nothing.

- `react`, `react-dom` (^18.3.1) — the UI, as AGENTS.md fixes the stack.
- `vite` (^5.4.11), `@vitejs/plugin-react` (^4.3.4) — dev server and build, same reason. Vite also
  proxies `/api` to Fastify so the `dev_actor` cookie is same-origin.
- `@types/react`, `@types/react-dom` (dev) — strict-mode typing for the UI.
- `concurrently` (^9.1.2, dev) — `npm run dev -w apps/kyc` has to start the API and Vite together;
  the alternative is two terminals, or a hand-rolled `child_process` script that gets the signal
  handling wrong.

## 6. Tests I disabled, skipped, or weakened

One, and it is a scaffold test, not a KYC one: `scaffold/tests/app-tables-audited.test.ts::SC-8 the
check looks at pg_trigger, and the scaffold's audited tables are found there` compared the full list
of tables carrying the `audit` trigger against `["_scaffold_fixture", "approval"]`. With `kyc_case` in
the database it fails — for the right reason, an app table exists and is audited. I changed the exact
equality to `expect.arrayContaining([...])` on those two scaffold tables, so the test still proves the
check reads `pg_trigger` and still fails if the scaffold's own tables lose their trigger, but no
longer forbids other audited tables from existing. The stronger property it used to imply — *no*
unaudited table — is asserted by the sibling test (`unauditedTables()` is `[]`) and by
`npm run tamper-check`, so nothing is now unchecked. No KYC test was weakened, skipped or removed.

## 7. Knowledge and context used

Knowledge notes, all read before writing code: **"Audit is a trigger, not code"** (before the
migration — it fixed the UUID `id` and the trigger statement), **"Routes go through route()"**
(before `server/app.ts`), **"Separation of duties"** (before the decision route — it is why
`decided_by` is `actor.id` and why the 409 is passed through instead of pre-checked), and
**"Non-goals"** (which fixed the boundary this session had to stay inside).

Repository files read first: `scaffold-spec.md` (the contract, and the AC list), `AGENTS.md`,
`verification-addendum.md` and `reports/TEMPLATE.md` for the artifacts, `reports/session-1b.md` for
the precedent this report follows, then the scaffold's source — `index.ts`, `server.ts`,
`with-actor.ts`, `authorize.ts`, `actor.ts`, `dev-identity.ts`, `governance.ts`, `seed.ts`,
`seed-data.ts`, `checks.ts`, `demo-server.ts` — the migrations `0001`–`0007` (for the `approval`
constraints and the grant pattern), and `scaffold/tests/helpers.ts` plus `routes.test.ts` and
`approval.test.ts` as the model for the KYC tests.

## 8. Timeline

Approximate, in order: reading spec/addendum/knowledge and the scaffold source ~25 min; planning the
app's shape ~10 min; migration `0100` ~5 min; seed discovery and fixtures ~15 min; server and query
layer ~35 min; UI ~40 min; tests ~35 min; debugging ~15 min; artifacts (README, governance report,
this file) ~25 min; PR and CI ~10 min.

Redone: the environment. The session started against a database with no relations and a stray
untracked `package-lock.json` blocking `git pull`; Postgres had to be started, `scripts/setup-db.sh`
re-run and the scaffold's own suite run green (`43 passed`) before any KYC code, so that a later
failure could not be blamed on setup. Also redone: the query layer's parameter type, from the
scaffold's `Tx` to `Pick<Tx, "query">`, so the same functions can be driven from a test's own
transaction.

## 9. Governance report

`npm run governance-report` → `wrote reports/governance/kyc.json: 1 table(s), 5 route(s), 0 outside the registry`

```json
{
  "app": "kyc",
  "tables": [
    {
      "name": "kyc_case",
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
    "insert",
    "update"
  ],
  "approval_constraints": [
    "approval_actor_matches",
    "approval_decision_has_decider",
    "approval_decision_has_rationale",
    "approval_decision_vocabulary",
    "approval_maker_checker"
  ],
  "app_role_grants": {
    "approval": [
      "INSERT",
      "SELECT",
      "UPDATE"
    ],
    "audit_event": [
      "SELECT"
    ],
    "kyc_case": [
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE"
    ]
  },
  "routes": [
    {
      "method": "GET",
      "path": "/api/cases",
      "action": "read",
      "resourceType": "kyc_case"
    },
    {
      "method": "GET",
      "path": "/api/cases/:id",
      "action": "read",
      "resourceType": "kyc_case"
    },
    {
      "method": "POST",
      "path": "/api/cases/:id/decision",
      "action": "approve",
      "resourceType": "kyc_case"
    },
    {
      "method": "POST",
      "path": "/api/cases/:id/review-requests",
      "action": "write",
      "resourceType": "kyc_case"
    },
    {
      "method": "GET",
      "path": "/api/me",
      "action": "read",
      "resourceType": "kyc_case"
    }
  ],
  "routes_outside_registry": []
}
```

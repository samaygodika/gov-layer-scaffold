# Session report — `1a`

Scope of this session, as instructed: the database layer only — migration runner, scaffold
migrations, trigger functions, seed, a test-only fixture table, and the tests for every scaffold
criterion provable with SQL alone. `withActor`, `route`, `authorize`, dev identity, CI, governance
report, and UI are out of scope and are left for session 1b.

## 1. Acceptance criteria

| id | criterion | status | test file::name | evidence |
|---|---|---|---|---|
| SC-1 | Migrations run clean on an empty database as `scaffold_owner` | pass | `scaffold/tests/migrations.test.ts::SC-1 every migration is applied and recorded in schema_migration`, `::SC-1 trigger functions are SECURITY DEFINER and owned by scaffold_owner` | `sudo -u postgres PGPASSWORD=postgres ./scripts/setup-db.sh && npm run migrate` on a dropped-and-recreated `tools`: `apply 0001_roles_grants.sql … apply 0007_scaffold_fixture.sql` |
| SC-2 | As `app_role`: INSERT, UPDATE and DELETE on `audit_event` all fail | pass | `scaffold/tests/audit-event-grants.test.ts::SC-2 app_role cannot INSERT into audit_event` (+ UPDATE, DELETE, `::SC-2 app_role holds only SELECT on audit_event`) | `npm test` → `✓ scaffold/tests/audit-event-grants.test.ts (4 tests)`; each rejection is SQLSTATE `42501 permission denied for table audit_event` |
| SC-3 | Inserting an `approval` with `decided_by = requested_by` is rejected | pass | `scaffold/tests/approval.test.ts::SC-3 an approval decided by its own requester is rejected`, `::SC-3 the same request decided by a second actor is accepted` | `npm test` → `✓ scaffold/tests/approval.test.ts (7 tests)`; rejection carries `constraint: approval_maker_checker` |
| SC-4 | `requested_by` ≠ `app.actor_id` on insert, or `decided_by` ≠ `app.actor_id` on update, is rejected | pass | `scaffold/tests/approval.test.ts::SC-4 requested_by that is not the transaction actor is rejected`, `::SC-4 decided_by that is not the transaction actor is rejected`, `::SC-4 requested_by cannot be rewritten after insert` | `npm test`; errors: `approval.requested_by (…) must equal app.actor_id (…)`, `approval.decided_by (…) must equal app.actor_id (…)` and `approval.requested_by is immutable once the row exists` |
| SC-5 | Setting `decision` without `rationale` is rejected | pass | `scaffold/tests/approval.test.ts::SC-5 a decision without a rationale is rejected`, `::SC-5 a rationale and decider without a decision is rejected` | `npm test`; constraints `approval_decision_has_rationale` and `approval_decision_has_decider` |
| SC-6 | An UPDATE on a fixture table inside an actor transaction produces exactly one `audit_event` with correct `before`, `after`, `actor_id`, `request_id`, `app` | pass | `scaffold/tests/audit-trigger.test.ts::SC-6 an UPDATE inside an actor transaction writes exactly one audit_event`, `::SC-6 a DELETE writes one audit_event with before set and after null` | `npm test` → `✓ scaffold/tests/audit-trigger.test.ts (3 tests)`; the update event matches `{actor_id: alice, app: "kyc", request_id: "req-sc6", before: {note: "before"}, after: {note: "after"}}` |
| SC-7 | The same UPDATE with no `app.actor_id` set fails with the trigger's error, and no row changes | pass | `scaffold/tests/audit-trigger.test.ts::SC-7 a mutation with no app.actor_id fails and changes no row` | `npm test`; error `audit_row: app.actor_id is not set; mutations must run inside withActor()`, and the row still reads `note = 'untouched'` afterwards |
| SC-8 | `all_app_tables_are_audited` passes and fails for a trigger-less table | not attempted | — | Out of scope: the CI test belongs to session 1b. The trigger it checks for is attached to every table this session created (`approval`, `_scaffold_fixture`). |
| SC-9 | `authorize()` denies when no matching `permission_grant` exists | not attempted | — | Out of scope: `authorize()` is session 1b. The `permission_grant` rows it reads are seeded here. |
| SC-10 | `all_routes_are_registered` passes and fails for a directly-registered route | not attempted | — | Out of scope: `route()` is session 1b. |
| SC-11 | Dev actor switcher works in development, absent in production | not attempted | — | Out of scope: dev identity is session 1b. The three actors it switches between are seeded here. |
| SC-12 | The scaffold exports no UI components | pass (vacuously) | — | `scaffold/` contains only `src/env.ts`, `src/migrations.ts`, `src/migrate.ts`, `src/seed-data.ts`, `src/seed.ts` and `tests/`; no UI is shipped. |
| SC-13 | `npm run governance-report` writes `reports/governance/<app>.json` | not attempted | — | Out of scope: the script is session 1b (`verification-addendum.md` §A). |
| SC-14 | `reports/session-<id>.md` filled from `reports/TEMPLATE.md` and committed in the PR | pass | — | This file, committed in the same PR. |

Test names carry the criterion id, and `npm test` writes `reports/junit/session-1a.xml`
(`--reporter=junit`). That path is gitignored by the repo's existing `.gitignore`.

## 2. Decisions I made that the spec did not

- **Migration numbering within `0001–0099`**: `0001` roles/grants, `0002` actor, `0003`
  permission_grant, `0004` audit_event, `0005` trigger functions, `0006` approval, `0007`
  `_scaffold_fixture`. The functions come before `approval` because both of its triggers reference
  them, and `audit_event` before the functions because `audit_row()` inserts into it.
- **`0001` asserts rather than creates the roles.** `CREATE ROLE` needs a superuser and the runner
  connects as `scaffold_owner`, so role creation stays in `scripts/setup-db.sh` (as the repo already
  had it) and `0001` raises a clear error if either role is missing, then fixes schema-level grants.
- **`npm run seed` connects as `scaffold_owner`, not `app_role`.** `.env.example` comments say seed
  uses `DATABASE_URL`, but `app_role` has SELECT-only on `actor` and `permission_grant` by the
  spec's own role table, so seeding them as `app_role` cannot work. Seeding is administrative, like
  migrating. Flagged as an ambiguity below rather than treated as a licence to widen the grants.
- **Actor ids are fixed uuids** (`…a11c`, `…b0b0`, `…ca01`), so tests and future fixtures can
  reference alice/bob/carol without a lookup round trip, and re-seeding is idempotent on
  `external_subject`.
- **Grants seeded for `kyc_case` and `refund_request`** — the two resource types the spec names —
  with `reviewer` → read/write/approve and `agent` → read/write.
- **Extra vocabulary CHECKs** on `permission_grant.action`, `audit_event.action` and
  `approval.decision`, so the vocabularies in the spec's tables are enforced rather than documented.
- **`audit_event.app` and `request_id` are nullable**, written as `nullif(setting, '')`. Only
  `app.actor_id` is mandatory; the spec makes the refusal specific to actor.
- **Trigger errors use `ERRCODE = 'raise_exception'` (P0001)** and name the failing column and the
  session actor, so an application-layer bug is legible in the message.
- **`_scaffold_fixture` is named with a leading underscore** to mark it as not an app table; the
  future `all_app_tables_are_audited` test will need to decide whether to include it (it has the
  trigger either way).
- **`approval.requested_by` is immutable after insert.** The spec pins `requested_by` to the session
  actor on insert only, which left one actor able to insert a request as themselves, UPDATE
  `requested_by` to a colleague, and then decide it — `approval_maker_checker` compares the two
  columns, not who wrote them. Adversarial testing hit exactly that path, so
  `approval_actor_matches()` now rejects any UPDATE that changes `requested_by`.
- **Tests roll back**: every test runs in a transaction that is rolled back, and re-sets
  `app.actor_id` mid-transaction where a second actor is needed, so cross-actor flows are provable
  without committing rows.

## 3. Ambiguities and questions

- **Which role runs `npm run seed`?** `.env.example` lists seed under `DATABASE_URL` (`app_role`),
  but the role table gives `app_role` SELECT-only on `actor` and `permission_grant`. Assumed the
  role table wins and used `DATABASE_URL_OWNER`. The alternative — granting `app_role` INSERT on
  `actor` — would weaken the mechanism, so I did not.
- **Are `actor` and `permission_grant` audited?** The spec attaches the audit trigger to "every app
  table" and shows `approval` being audited. I attached it to `approval` and `_scaffold_fixture`
  only: `actor` is IdP-synced and `permission_grant` is configuration, and auditing them would make
  seeding require an actor id that does not exist yet on a fresh database.
- **Should `approval` have a `CHECK ((decision IS NULL) = (decided_at IS NULL))`?** The spec lists
  three CHECKs and does not mention `decided_at`. I implemented exactly the listed three plus a
  decision-vocabulary check, and left `decided_at` unconstrained.
- **Does SC-1 want a test that itself runs the migrations?** That would need a `scaffold_owner`
  connection inside the suite, which the repo explicitly treats as the thing not to do. I verified
  the clean run from the command line (dropped `tools`, recreated it, ran `npm run migrate`) and
  the test asserts the resulting state — applied ledger, table set, function ownership and
  `SECURITY DEFINER`.
- **`--rows=N` for `npm run seed`**: `AGENTS.md` mentions it for load data, but no app tables exist
  yet. The flag is accepted and prints that app sessions seed their own load data.
- **Node version**: `AGENTS.md` says Node 22; the machine's default `node` is v20 with 22 available
  via nvm. I ran everything on v22 and set `engines.node >= 22`. Session 1b's CI should pin 22.
- **`audit_event.resource_id` for a table without an `id`**: the trigger reads `to_jsonb(row)->>'id'`
  and would record NULL. The convention says every audited table has a uuid `id`; the future CI
  test is what enforces it.

## 4. Things I wanted to change but did not

- Nothing in the scaffold contract. Two places where I stopped rather than widen it: seeding as
  `app_role` (see §3) and auditing `actor`/`permission_grant`.
- `.env.example`'s comment listing `npm run seed` under `DATABASE_URL` is now inaccurate. I left the
  file untouched and recorded the discrepancy here instead of editing an existing repo file to match
  my implementation.

## 5. Dependencies added

Runtime:
- `pg` — Postgres client; the stack decision says `pg`, no ORM.
- `dotenv` — loads `.env` so the runner, seed and tests read `DATABASE_URL`/`DATABASE_URL_OWNER`.

Dev:
- `typescript` — TypeScript strict, per `AGENTS.md`.
- `tsx` — runs the `.ts` runner and seed scripts directly, so there is no build step for `npm run migrate`.
- `vitest` — test runner named in the stack; also emits the junit report.
- `@types/node`, `@types/pg` — types for the above.

No HTTP, UI or lint dependencies: those belong to the sessions that build the server and UI.

## 6. Tests I disabled, skipped, or weakened

None.

## 7. Knowledge and context used

Knowledge notes accessed, all before writing any code: "Non-goals", "Separation of duties", "Audit
is a trigger, not code", "Routes go through route()" (read, then set aside as out of scope), and the
auto-generated repo index.

Files read before writing code: `AGENTS.md`, `scaffold-spec.md`, `verification-addendum.md`,
`README.md`, `reports/TEMPLATE.md`, `.env.example`, `.gitignore`, `scripts/setup-db.sh`.

## 8. Timeline

Approximate minutes: reading spec/addendum/knowledge 5; planning 2; migrations 8; runner and seed 5;
tests 8; debugging 3 (test helper imported the migration runner module, which would have opened a
`scaffold_owner` connection from the test process — split the file-listing helper out into
`scaffold/src/migrations.ts`); clean-database re-verification 2; report and PR 8. No phase redone.

## 9. Governance report

None — `npm run governance-report` is built in session 1b (`verification-addendum.md` §A), and it
also needs the route registry, which does not exist yet.

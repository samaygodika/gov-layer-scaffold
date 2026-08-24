# Internal Tools Scaffold — Specification (v2)

Human-authored. This is the architectural contract. Devin implements it; Devin does not redesign it.

**What changed from v1 and why.** v1 said audit was "enforced structurally, not by convention," but its mechanism was a TypeScript wrapper, and nothing stops app code from bypassing a TypeScript wrapper. v2 moves audit into Postgres triggers and splits the database into two roles, so the guarantees are made by the database rather than by code review. v2 also adds a minimal UI per app and a dev-mode identity switcher so the guarantees can be demonstrated, not just asserted.

## Purpose

A thin governance layer for internal tools. It exists so that N applications share **one** audit format, **one** permission model, and **one** separation-of-duties mechanism.

"Enforced structurally" has a precise meaning here: **the database refuses, rather than a reviewer catches.** Where a mechanism doesn't meet that bar, this spec says so.

Explicit non-goal: this is not a UI framework, an ORM, or a low-code platform. Keep it small.

## Stack

- TypeScript, Node, Postgres
- Migrations: plain SQL, checked into the repo, run in order
- Auth: OIDC in production; the scaffold consumes claims and never stores credentials. The prototype uses a dev-mode actor switcher (see below) that produces the same `actor` object OIDC middleware would.
- UI: React + Vite, one small app per tool. No design system. The scaffold ships no UI components.

## Two database roles — the mechanism behind everything else

| role | used for | can do |
|---|---|---|
| `scaffold_owner` | running migrations | owns all tables and trigger functions |
| `app_role` | what the application connects as | SELECT on `actor`, `permission_grant`, `audit_event`; on `approval`: SELECT, INSERT, and **column-limited UPDATE** (`decided_by`, `decision`, `decided_at`, `rationale` only); full DML on app tables; **nothing else** |

`app_role` has **no INSERT, UPDATE, or DELETE on `audit_event`**. Audit rows still get written because the trigger functions are `SECURITY DEFINER` and owned by `scaffold_owner`. This gap between the two roles is what makes the audit tamper-proof and hand-written audit rows impossible.

The application must never connect as `scaffold_owner`. The connection string in `.env.example` is `app_role`.

## Transaction context

Every mutating request runs inside one helper:

```ts
withActor(actor, requestId, app, async (tx) => { ... })
// BEGIN;
// SET LOCAL app.actor_id   = '<uuid>';
// SET LOCAL app.request_id = '<id>';
// SET LOCAL app.name       = 'kyc';
// ...fn...
// COMMIT;
```

That is the helper's entire job. It carries **no audit logic**. The triggers read these settings. A mutation attempted without them fails (see mechanism 1).

## Core tables (scaffold-owned; app code must not alter these)

### `actor`
Synced from the IdP (seeded in dev). App code has SELECT only.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `external_subject` | text unique | OIDC `sub` |
| `email` | text | |
| `groups` | text[] | from IdP claims |
| `active` | boolean | |

### `permission_grant`
Role-to-capability mapping. Roles derive from IdP groups; the mapping is configuration.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `role` | text | matches an IdP group name |
| `resource_type` | text | e.g. `kyc_case` |
| `action` | text | `read` \| `write` \| `approve` |

Unique on (`role`, `resource_type`, `action`).

### `audit_event`
Append-only. **Written only by the `audit_row()` trigger.** `app_role` cannot insert, update, or delete.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `occurred_at` | timestamptz | default now() |
| `actor_id` | uuid fk → actor | from `app.actor_id` setting |
| `app` | text | from `app.name` setting |
| `action` | text | `insert` \| `update` \| `delete` (from `TG_OP`) |
| `resource_type` | text | `TG_TABLE_NAME` |
| `resource_id` | text | `id` of the row |
| `before` | jsonb | `to_jsonb(OLD)`; null on insert |
| `after` | jsonb | `to_jsonb(NEW)`; null on delete |
| `request_id` | text | from `app.request_id` setting |

Index on (`resource_type`, `resource_id`, `occurred_at`).

Note the action vocabulary changed from v1: it is now the raw row operation. Approve/reject decisions are visible because the `approval` table is itself audited — a decision shows up as an `update` on `approval` whose before/after diff contains the decision. This is the "generic diffs are less semantically rich" trade-off from v1, now taken all the way. Silent omission is still the worse failure.

### `approval`
Separation of duties.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `resource_type` | text | |
| `resource_id` | text | |
| `requested_by` | uuid fk → actor | |
| `decided_by` | uuid fk → actor | nullable until decided |
| `decision` | text | `approved` \| `rejected` |
| `decided_at` | timestamptz | |
| `rationale` | text | |

Constraints, all at the table:
- `CHECK (decided_by IS NULL OR decided_by <> requested_by)` — maker-checker
- `CHECK ((decision IS NULL) = (decided_by IS NULL))` and `CHECK ((decision IS NULL) = (rationale IS NULL))` — a decision always has a decider and a rationale
- trigger `approval_actor_matches()` — see mechanism 3
- `requested_by`, `resource_type`, `resource_id` immutable after insert — enforced by the column-level UPDATE grant (mechanism 3), not a CHECK

## The three enforcement mechanisms

### 1. Audit is written by a database trigger, not by application code

One trigger function, `audit_row()`, `SECURITY DEFINER`, owned by `scaffold_owner`:

- `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW`
- reads `current_setting('app.actor_id', true)`; **raises an exception if it is null or empty** — an unattributed mutation is refused, which is how a mutation outside `withActor()` fails
- writes one `audit_event` row with `to_jsonb(OLD)` / `to_jsonb(NEW)`, in the same transaction

**Every app table attaches it in the migration that creates the table:**

```sql
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON kyc_case
  FOR EACH ROW EXECUTE FUNCTION audit_row();
```

Convention this depends on: every audited table has a `uuid` column named `id` as its primary key. The trigger reads `resource_id` from it.

What this guarantees, and how:

| attempt | outcome | enforced by |
|---|---|---|
| mutation inside `withActor()` through any code path — ORM, raw SQL, psql | audited | trigger |
| mutation with no actor set | refused | trigger raises |
| hand-written or edited audit row from app code | impossible | no grant on `audit_event` |
| app table created without the trigger | caught in CI | test `all_app_tables_are_audited` queries `pg_trigger` for every non-scaffold table in the schema and fails if any lacks `audit` |

The last row is the one gap: attaching the trigger is a per-table step. The CI test closes it. (Optional, not required for the prototype: an event trigger on `CREATE TABLE` that attaches `audit` automatically would close it at the database. Mention in the README as the production hardening step; don't build it.)

### 2. Authorization goes through one choke point — app layer, stated honestly

Routes are defined only through a scaffold helper:

```ts
route({ method, path, action, resourceType }, handler)
```

The helper calls `authorize(actor, action, resourceType)` before invoking the handler and denies by default when no matching `permission_grant` exists. The scaffold does not export the raw framework router, so registering a route that skips authorization requires importing the framework directly.

`route()` also records every registration in a registry. A scaffold test, `all_routes_are_registered`, compares the framework's own route table against the registry and fails on any route the registry doesn't know about — that is a route that skipped `authorize()`.

**This is still the weakest of the three mechanisms** and the spec says so: it is enforced by the helper's shape and a CI test, not by the database. It stays app-layer because per-route authorization has no clean database equivalent short of RLS (see limitation below). Do not pretend it is stronger than it is.

### 3. Separation of duties lives in the schema — and the decider can't be spoofed

The `CHECK` constraint above rejects `decided_by = requested_by`. On its own that is bypassable if application code copies `decided_by` from the request body: a client could submit someone else's id. So a second trigger, `approval_actor_matches()`, `BEFORE INSERT OR UPDATE ON approval`:

- on insert, `NEW.requested_by` must equal `current_setting('app.actor_id')`
- whenever `NEW.decided_by` is not null, it must equal `current_setting('app.actor_id')`
- after insert, `requested_by`, `resource_type`, and `resource_id` are **immutable**: `app_role`'s UPDATE grant on `approval` is limited to `decided_by`, `decision`, `decided_at`, `rationale`. This is enforced by the column-level grant, not by trigger logic — the database rejects the write, so no enumeration of bad updates is required. Without it a single actor can request as themselves, rewrite `requested_by` to a second actor and self-decide, or repoint an already-decided approval at a different `resource_id` that was never reviewed. Both satisfy the maker-checker `CHECK`, which compares the two columns rather than who wrote them.

With this, the identity in every `approval` row is the identity of the transaction that wrote it, whatever the application passed in. App code must **still** set `requested_by` / `decided_by` from the session actor, never from the request body — the trigger is there so that getting this wrong fails loudly instead of silently.

## Dev-mode identity (prototype only)

Seed three actors:

| actor | groups | can |
|---|---|---|
| `alice` | `reviewer` | read, write, approve |
| `bob` | `reviewer` | read, write, approve |
| `carol` | `agent` | read, write |

In `NODE_ENV=development` only, the `X-Dev-Actor` header (or a cookie set by a switcher in the UI top bar) selects the actor. This must be **impossible to enable in production** — the middleware must not be registered at all unless `NODE_ENV=development`, and the test suite asserts that.

This is what makes maker-checker demonstrable: request a refund as bob, try to approve it as bob → refused; switch to alice → succeeds. The audit history on the detail page then shows both attempts. Production replaces the switcher with OIDC middleware that produces the same `actor` object; nothing downstream changes.

## Known limitation (state it, don't hide it)

Row-level filtering is implemented in the application layer via a single query builder, not Postgres RLS. RLS is stronger — an application bug cannot leak rows — but is harder to iterate on inside a time-boxed prototype. **Production should use RLS**, and the two-role split plus `SET LOCAL app.actor_id` are already the foundation RLS policies would key on. This must appear in the README alongside the dev-mode identity caveat.

## Applications

Two apps, built in separate sessions, on the scaffold as-is.

**KYC review queue** — `kyc_case`: `subject_name`, `submitted_at`, `risk_tier` (`low`/`medium`/`high`), `documents` (jsonb), `status` (`pending`/`approved`/`rejected`). Cases are seeded (they arrive from upstream; there is no create screen). Reviewers read and decide; a decision requires an `approval` row and the case status follows it.

**Refunds dashboard** — `refund_request`: `transaction_ref`, `amount_cents`, `currency`, `reason`, `requested_at`, `status`. Agents create. Requests at or above **10,000 cents** require an `approval` row from a second person before status can become `approved`; below the threshold the creating agent may complete it directly. (Yes, that means small refunds skip maker-checker. That is the business rule, and the audit trail still records who did it.)

### UI — each app, three screens, nothing more

1. **List** — server-side paginated (page size 50), newest first, with filters: KYC `status` + `risk_tier`; refunds `status` + `currency`. Row click → detail. No client-side filtering of full tables.
2. **Detail** — all fields; action buttons (`approve`, `reject`, and `create`/`complete` for refunds) rendered only when `authorize()` would allow them; rationale is a required text input on approve/reject; **audit history** for this resource rendered as a timeline from `audit_event`, showing actor, time, and the before/after diff.
3. **Create** (refunds only) — form for a new `refund_request`.

Plus the dev-mode actor switcher in the top bar. Plain HTML controls are fine. The UI exists so the guarantees are visible; it is not the thing being evaluated.

## Acceptance criteria

Devin self-checks these before declaring a session done. A human verifies them independently afterwards.

Every criterion has an id. **Test names begin with the id** (`it("SC-2 app_role cannot INSERT into audit_event", ...)`). Tests run with `--reporter=junit --outputFile=reports/junit/<session>.xml`. A criterion with no test of that id counts as not attempted.

**Scaffold session**
- [ ] SC-1 Migrations run clean on an empty database as `scaffold_owner`
- [ ] SC-2 As `app_role`: INSERT, UPDATE, and DELETE on `audit_event` all fail
- [ ] SC-3 Inserting an `approval` with `decided_by = requested_by` is rejected
- [ ] SC-4 Inserting an `approval` whose `requested_by` ≠ `app.actor_id`, or updating one with `decided_by` ≠ `app.actor_id`, is rejected
- [ ] SC-5 Setting `decision` without `rationale` is rejected
- [ ] SC-6 An UPDATE on a fixture table inside `withActor()` produces exactly one `audit_event` with correct `before`, `after`, `actor_id`, `request_id`, `app`
- [ ] SC-7 The same UPDATE with no `app.actor_id` set (e.g. via psql as `app_role`) fails with the trigger's error, and no row changes
- [ ] SC-8 `all_app_tables_are_audited` passes, **and** fails when a trigger-less table is added in a throwaway migration — test the test
- [ ] SC-9 `authorize()` denies when no matching `permission_grant` exists
- [ ] SC-10 `all_routes_are_registered` passes, **and** fails when a route is registered on the framework directly — test the test
- [ ] SC-11 Dev actor switcher works in development and the middleware is absent in production; a test proves both
- [ ] SC-12 The scaffold exports no UI components
- [ ] SC-13 `npm run governance-report` writes `reports/governance/<app>.json` in the shape given in `verification-addendum.md`, with deterministic ordering
- [ ] SC-14 `reports/session-<id>.md` is filled from `reports/TEMPLATE.md` and committed in the PR

**Each app session**
- [ ] AC-1 The migration that creates the app table attaches the `audit` trigger (CI proves it)
- [ ] AC-2 Every route is defined via `route()`; `all_routes_are_registered` passes
- [ ] AC-3 Approve/reject writes an `approval` row with `decided_by` taken from the session actor
- [ ] AC-4 Self-approval is refused **through the UI**: create/request as bob, approve as bob, observe the error; approve as alice, observe success
- [ ] AC-5 Detail page shows the audit history including the successful decision's diff
- [ ] AC-6 List paginates server-side; verified with 10,000 seeded rows
- [ ] AC-7 README documents how to run, seed, and switch dev actors
- [ ] AC-8 `reports/governance/<app>.json` is generated and committed
- [ ] AC-9 `reports/session-<id>.md` is filled and committed in the PR

## Session structure

Three Devin sessions. Sessions 2 and 3 receive this spec plus a short instruction only:

> Build the [KYC review queue / refunds dashboard] described in the spec, using the existing scaffold's audit, authorization, and approval primitives. Do not create new ones.

Do not re-explain the design in sessions 2 or 3. How much additional context each app requires is itself a result.

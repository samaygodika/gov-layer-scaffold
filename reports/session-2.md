# Session report — `2` (apps: kyc, refunds)

This session combines the KYC review queue and refunds dashboard on the shared scaffold.
Both apps retain their routed APIs, React/Vite UIs, database audit triggers, and governance
artifacts. No scaffold migration, trigger function, role, `withActor()`, `route()`, or CI
file was edited.

## 1. Acceptance criteria

| id | criterion | status | test file::name | evidence |
|---|---|---|---|---|
| SC-1 | Migrations run clean on an empty database as `scaffold_owner` | pass | `scaffold/tests/migrations.test.ts` | `npm run migrate` — all migrations including `0100_kyc_case.sql` and `0200_refund_request.sql` applied |
| SC-2 | `app_role` cannot mutate `audit_event` | pass | `scaffold/tests/audit-event-grants.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-3 | Approval self-decision is rejected | pass | `scaffold/tests/approval.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-4 | Approval actor identities must match the session actor | pass | `scaffold/tests/approval.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-5 | Decisions require a rationale | pass | `scaffold/tests/approval.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-6 | Mutations inside `withActor()` are audited with context | pass | `scaffold/tests/with-actor.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-7 | Mutations without `app.actor_id` fail and do not change rows | pass | `scaffold/tests/audit-trigger.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-8 | All app tables are audited and the guardrail catches omissions | pass | `scaffold/tests/app-tables-audited.test.ts` | `npm run tamper-check` — `ok: both guardrails fired` |
| SC-9 | Authorization denies missing grants and agent approval | pass | `scaffold/tests/authorize.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-10 | Every route is registered through `route()` and the guardrail catches bypasses | pass | `scaffold/tests/routes.test.ts` | `npm run tamper-check` — `ok: both guardrails fired` |
| SC-11 | Development identity switching works and production ignores the dev middleware | pass | `scaffold/tests/dev-identity.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-12 | The scaffold exports no UI components or framework router | pass | `scaffold/tests/scaffold-exports.test.ts` | `SESSION=session-2 npm test` — `Tests 69 passed (69)` |
| SC-13 | Governance reports have the required deterministic shape | pass | `scaffold/tests/governance-report.test.ts` | `npm run governance-report` — both app reports written with no routes outside their registries |
| SC-14 | This session report is filled from the template and committed | pass | `apps/kyc/tests/kyc-artifacts.test.ts` | `SESSION=session-2 npm test` — report headings match `reports/TEMPLATE.md` |
| AC-1 | KYC migration attaches the audit trigger | pass | `apps/kyc/tests/kyc-table.test.ts` | `SESSION=session-2 npm test` — KYC table, grants, and audit behavior pass |
| AC-2 | Every KYC route is defined through `route()` | pass | `apps/kyc/tests/kyc-routes.test.ts` | `npm run governance-report` — KYC has 5 registered routes and none outside the registry |
| AC-3 | KYC decisions use the session actor for `decided_by` | pass | `apps/kyc/tests/kyc-routes.test.ts` | `SESSION=session-2 npm test` — actor spoofing fields are ignored |
| AC-4 | KYC self-approval is refused and a second actor can approve | pass | `apps/kyc/tests/kyc-routes.test.ts` | `SESSION=session-2 npm test` — maker-checker and second-reviewer flow pass |
| AC-5 | KYC detail history includes the successful decision diff | pass | `apps/kyc/tests/kyc-routes.test.ts` | `SESSION=session-2 npm test` — approval and case audit diffs are returned |
| AC-6 | KYC list uses server-side pagination with 10,000 rows | pass | `apps/kyc/tests/kyc-routes.test.ts` | `SESSION=session-2 npm test` — page size, filters, and `EXPLAIN` limit checks pass |
| AC-7 | KYC README documents running, seeding, and actor switching | pass | `apps/kyc/tests/kyc-artifacts.test.ts` | `SESSION=session-2 npm test` — KYC artifact checks pass |
| AC-8 | KYC governance report is generated and committed | pass | `apps/kyc/tests/kyc-artifacts.test.ts` | `npm run governance-report` — KYC report retained alongside refunds |
| AC-9 | KYC session report is filled and committed | pass | `apps/kyc/tests/kyc-artifacts.test.ts` | `SESSION=session-2 npm test` — combined report is non-empty and template-shaped |
| AC-1 | Refunds migration attaches the audit trigger | pass | `apps/refunds/tests/routes.test.ts` | `SESSION=session-2 npm test` — refunds audit trigger and app-table guard pass |
| AC-2 | Every refunds route is defined through `route()` | pass | `apps/refunds/tests/routes.test.ts` | `npm run governance-report` — refunds has 6 registered routes and none outside the registry |
| AC-3 | Refund decisions use the session actor for `decided_by` | pass | `apps/refunds/tests/routes.test.ts` | `SESSION=session-2 npm test` — actor spoofing fields are ignored |
| AC-4 | Refund self-approval is refused and a second actor can approve | pass | `apps/refunds/tests/routes.test.ts` | `SESSION=session-2 npm test` — maker-checker flow passes |
| AC-5 | Refund detail history includes the successful decision diff | pass | `apps/refunds/tests/routes.test.ts` | `SESSION=session-2 npm test` — approval and refund status diffs are returned |
| AC-6 | Refund list uses server-side pagination with 10,000 rows | pass | `apps/refunds/tests/routes.test.ts` | `SESSION=session-2 npm test` — page size, ordering, and deep-page checks pass |
| AC-7 | Refunds README documents running, seeding, and actor switching | pass | none | README documents `npm run dev`, `--rows=10000`, and actor switching |
| AC-8 | Refunds governance report is generated and committed | pass | none | `git diff --exit-code -- reports/governance` — clean after fresh generation |
| AC-9 | Refunds session report is filled and committed | pass | none | `test -s reports/session-2.md` — combined report is non-empty |

Full combined run: `SESSION=session-2 npm test` — `Test Files 15 passed (15)`,
`Tests 69 passed (69)`.

## 2. Decisions I made that the spec did not

- Used a 1-based refunds `page` parameter: omitted or empty values default to page 1,
  while non-integer and non-positive values return HTTP 400.
- Kept page size at 50 and performed filtering, counting, ordering, and offsets in SQL
  for both applications.
- Used `write` to open a review and `approve` to decide it, preserving the scaffold's
  distinction between triage and approval.
- Required pending state before a refund can request review or complete; threshold
  enforcement remains in the database trigger.
- Rendered audit histories oldest-first and joined approval actor external subjects so
  the UI shows human-readable identities.
- Seeded refund fixtures as Carol, the agent representing the domain's intake actor.
  Seed functions now use the merged scaffold contract:
  `seedApp(client, { rows }) => Promise<string>`.
- The root seed discovers both app seed modules, passes `--rows=N`, and invokes them
  with the owner client while each app sets `app.actor_id`, `app.request_id`, and
  `app.name` for trigger attribution.
- Kept the root TypeScript project as the sole UI typecheck project, matching KYC.
  The refunds per-app `tsconfig.json` was removed, and the root `typecheck` script is
  the merged main version: `tsc --noEmit`.
- Kept the root Vitest discovery pattern `apps/*/tests/**/*.test.ts`, which runs both
  app suites together.
- The KYC app treats the first reviewer opening a review as the maker for upstream
  cases, while seeded KYC cases remain pending and attributed to Carol.

## 3. Ambiguities and questions

- `refund_request` deliberately has no `requested_by` column; its creator is recovered
  from the insert audit event.
- The 10,000-cent threshold appears in both migration enforcement and application
  capability calculation; the migration remains authoritative.
- The KYC upstream case has no creator in its table, so the reviewer opening a review
  becomes the maker.
- The response envelope for refund approval creation was unspecified; it returns the
  inserted approval with HTTP 201.
- The scaffold has one `approve` action, so a reviewer with that grant can approve or
  reject; a separate reject permission would require a new scaffold action.
- The app-specific visual designs are intentionally plain controls and tables; no
  browser automation harness is part of the repository.

## 4. Things I wanted to change but did not

- No scaffold governance primitive was changed. Migrations `0001`–`0007`, the actor,
  permission, audit, and approval tables, trigger functions, `withActor()`, `route()`,
  server implementation, and CI configuration remain from main.
- The merged scaffold audit test uses `expect.arrayContaining(["_scaffold_fixture",
  "approval"])`; it does not enumerate either app table, allowing KYC and refunds to
  coexist.
- No application prechecks replace database maker-checker, actor-match, rationale, or
  threshold enforcement.

## 5. Dependencies added

- KYC dependencies remain in `apps/kyc/package.json`: React 18, React DOM, React types,
  Vite React plugin, Vite 5, and `concurrently`.
- Refunds dependencies remain in `apps/refunds/package.json`: React 18, React DOM,
  React types, Vite React plugin, Vite 6, and `concurrently`.
- The package lock retains dependency entries for both workspaces.

## 6. Tests I disabled, skipped, or weakened

none

## 7. Knowledge and context used

Repository files read before the rebase and verification included `scaffold-spec.md`,
`AGENTS.md`, `verification-addendum.md`, both app READMEs, `reports/TEMPLATE.md`,
the scaffold source/tests, and both app source/tests.

The merged main branch's KYC report and governance artifact were retained; this report
adds the refunds evidence and the combined-suite facts.

## 8. Timeline

- Fetched merged `origin/main` at `5861b78` and rebased the four refunds commits.
- Resolved shared scaffold files in favor of main, then adapted refunds to the merged
  seed contract and root TypeScript/Vitest configuration.
- Merged workspace dependency metadata and preserved both app documentation/artifacts.
- Fresh-database verification covered migration, both app seeds, combined typecheck,
  combined tests, tamper checks, governance reports, and the refunds build.

## 9. Governance report

`npm run governance-report` writes both artifacts without clobbering either app:

```text
wrote reports/governance/kyc.json: 1 table(s), 5 route(s), 0 outside the registry
wrote reports/governance/refunds.json: 1 table(s), 6 route(s), 0 outside the registry
```

Both reports retain their audited table, registered routes, expected grants, and
`routes_outside_registry: []`.

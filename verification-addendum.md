# Verification & Metrics Addendum

What Devin produces, in a fixed shape, so the three research questions can be answered by diffing artifacts rather than by reading PRs. Everything here is committed to the repo by the session that produced it.

---

## A. `npm run governance-report` — the reproducibility artifact

A scaffold script (built in session 1b) that connects as `app_role` and writes `reports/governance/<app>.json`:

```json
{
  "app": "kyc",
  "tables": [
    { "name": "kyc_case", "pk": "id:uuid", "audit_trigger": true }
  ],
  "audit_event_shape": ["id","occurred_at","actor_id","app","action","resource_type","resource_id","before","after","request_id"],
  "audit_actions_seen": ["insert","update"],
  "approval_constraints": ["approval_maker_checker","approval_decision_has_decider","approval_decision_has_rationale","approval_actor_matches"],
  "app_role_grants": { "audit_event": ["SELECT"], "approval": ["SELECT","INSERT","UPDATE"], "kyc_case": ["SELECT","INSERT","UPDATE","DELETE"] },
  "routes": [
    { "method": "GET",  "path": "/cases",            "action": "read",    "resourceType": "kyc_case" },
    { "method": "POST", "path": "/cases/:id/decide", "action": "approve", "resourceType": "kyc_case" }
  ],
  "routes_outside_registry": []
}
```

Sources: `pg_trigger`, `pg_constraint`, `information_schema.role_table_grants`, `information_schema.columns`, and the route registry (B). Deterministic ordering so two files diff cleanly.

**Analysis:** `diff reports/governance/kyc.json reports/governance/refunds.json`. Expected: only `app`, table names, and route paths differ. Anything else differing is a reproducibility failure and goes in the write-up verbatim.

## B. Route registry test — closes the gap in mechanism 2

`route()` now records every registration in an in-memory registry. A scaffold test, `all_routes_are_registered`, compares Fastify's own route table (`app.printRoutes` / `onRoute` hook) with the registry. Any route Fastify knows about that the registry doesn't is a route that bypassed `authorize()`. Test fails, and the route appears in `routes_outside_registry` above.

This upgrades mechanism 2 from "convention plus review" to "CI refuses." Worth a sentence in the video: it is the same move as the audit trigger, one level up.

## C. Criterion IDs on tests

Every acceptance criterion in the spec has an id (`SC-n` for scaffold, `AC-n` for apps). Test names begin with the id: `it("SC-2 app_role cannot INSERT into audit_event", ...)`. Vitest runs with `--reporter=junit --outputFile=reports/junit/<session>.xml`.

**Analysis:** a ten-line script maps ids → pass/fail across sessions. Coverage of the criteria is then a table, not a claim. A criterion with no test of that id is "not attempted", regardless of what the PR says.

## D. Session reports — Devin's own account, in a fixed shape

Each session ends by filling `reports/TEMPLATE.md` into `reports/session-<id>.md` and committing it in the same PR. Sections 3 (ambiguities) and 4 (wanted to change but didn't) are the most valuable: they are Devin's side of "how much context does app N need," complementing the human's intervention count.

Treat sections 1, 6, and 9 as claims to verify, not evidence. Sections 2–5, 7, and 8 are data about the spec and the scaffold, and are useful even if imperfect.

**Analysis across sessions 2 and 3:** count ambiguities; check whether the same ambiguity appears in both (spec defect) or one (domain-specific). Compare section 5 — dependency drift between two apps built from the same spec is a maintenance-burden finding.

## E. Devin-side metrics (pulled by the human, not Devin)

Per session, from the Devin app after the session ends:
- ACUs consumed (usage page; the API also exposes consumption metrics if you want it scripted)
- Wall-clock from first message to PR opened
- **Accessed Knowledge** panel — which notes, cross-checked against report section 7
- Number of questions Devin asked the human, and number of messages the human sent after the first (interventions)
- Commit timestamps from `git log --format='%H %ct %s'` on the PR branch — gives phase durations independent of Devin's self-reported timeline (section 8)

Record all of these in the tracking sheet in `build-plan.md`.

## F. Tamper check — tests the guardrails, not Devin

After session 1b merges, on a throwaway branch, the human commits three deliberate violations and pushes:
1. an app table with no `audit` trigger
2. a route registered on Fastify directly, skipping `route()`
3. a test whose connection string is `DATABASE_URL_OWNER`

Expected: CI fails on (1) and (2). (3) is expected to *pass* CI — there is no structural guard against it — which is why the review step reads commit sequences for it. Record the result; it's the honest boundary of what the scaffold enforces and belongs in the README's limitations section with RLS.

---

## Mapping to the research questions

| question | primary evidence | secondary |
|---|---|---|
| Does the pattern reproduce? | A: governance report diff | C: AC-n pass table for both apps; B: `routes_outside_registry` empty |
| Marginal cost of app N | E: ACUs + human minutes per session | E: commit timestamps; D §8 |
| Human context needed per app | E: interventions + Accessed Knowledge | D §3, §4 across both apps |
| Maintenance burden (asked for, previously unmeasured) | D §5 dependency lists, diffed | D §2 decisions Devin made that the spec didn't |
| Where the guardrails stop | F: tamper check | spec's own "weakest mechanism" statement |

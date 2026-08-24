# internal-tools-scaffold

A prototype built with Devin to answer one question for a fintech engineering team weighing Power Apps against building in-house: **can many internal tools share one governance layer — one audit trail, one permission model, one separation-of-duties rule — enforced by the database rather than by convention, with Devin doing the building?**

It contains a small scaffold (four tables, two triggers, two helpers) and two apps built on it in separate Devin sessions from a one-sentence prompt each: a KYC review queue and a refunds dashboard. The interesting output is not the apps; it is whether they came out structurally identical, and what each one cost.

- `scaffold-spec.md` — the architectural contract (human-written; Devin implements, does not redesign)
- `verification-addendum.md` — what gets measured and how
- `reports/` — per-session reports and governance JSON, committed by the session that produced them
- `AGENTS.md` — instructions for Devin

## Running

_Filled in by the scaffold sessions. Until then:_

```
./scripts/setup-db.sh        # creates roles + database on local Postgres
cp .env.example .env
npm install
npm run migrate              # as scaffold_owner
npm run seed                 # alice / bob / carol + grants
npm test                     # as app_role
```

## Known limitations

Stated here on purpose, not buried:

- Row-level filtering is done in the application query builder, not Postgres RLS. Production should use RLS; the two-role split and `SET LOCAL app.actor_id` are the foundation it would key on.
- Identity in this prototype is a dev-mode actor switcher (`X-Dev-Actor`), registered only when `NODE_ENV=development`. Production replaces it with OIDC middleware producing the same `actor` object.
- A test that quietly connects as `scaffold_owner` has no structural guard. It is caught by reading commit history, not by CI. See the tamper check in `verification-addendum.md`.

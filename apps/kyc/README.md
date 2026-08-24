# apps/kyc — KYC review queue

A reviewer-facing queue over one table, `kyc_case`. Cases arrive from upstream, so there is no
create screen: a reviewer reads a case, opens a review on it, and a *second* reviewer approves or
rejects it with a rationale.

Nothing in this app enforces that rule. A decision is an `UPDATE` on the scaffold's `approval` table
with `decided_by` taken from the session actor, and `approval_maker_checker` /
`approval_actor_matches` refuse it when the decider is the requester or is not the actor in the
transaction. The audit trail is likewise the `audit` trigger on `kyc_case` and `approval` — this app
never writes `audit_event`.

## Running

From the repository root, with the roles, database, migrations and seed already in place
(see the root README):

```
npm run migrate                    # applies migrations/0100_kyc_case.sql as scaffold_owner
npm run seed                       # actors + grants + 24 pending kyc_case rows, as scaffold_owner
npm run seed -- --rows=10000       # the AC-6 load: tops kyc_case up to 10,000 pending cases
npm run dev -w apps/kyc            # Fastify on :3000 and Vite on :5173 (open :5173)
```

`NODE_ENV=development` (it is in `.env.example`) is what registers the scaffold's dev-identity hook;
without it there is no way to be anybody and every request is `401`. Vite proxies `/api` to Fastify, so
the UI is same-origin and the `dev_actor` cookie reaches the server.

Server only: `npm run dev:server -w apps/kyc`.

## Switching dev actors

Identity in development is the scaffold's header or cookie and nothing else. The switcher in the
top-right of the UI writes the `dev_actor` cookie and reloads; the seeded actors are:

| actor | groups | read | write (open a review) | approve / reject |
|---|---|---|---|---|
| alice | reviewer | yes | yes | yes |
| bob | reviewer | yes | yes | yes |
| carol | agent | yes | yes | **denied (403)** |

The same actors from the command line:

```
curl -H 'X-Dev-Actor: alice' localhost:3000/api/cases?status=pending
curl -b 'dev_actor=carol'    localhost:3000/api/cases
```

The detail screen renders the review/decide buttons from `GET /api/cases/:id`'s `can` block, which
comes from the scaffold's `isAuthorized()` — the same grant lookup `route()` uses. So carol never
sees a decide button, and a request that skips the UI is denied anyway.

## Maker-checker, end to end

```
curl -b 'dev_actor=bob'   -XPOST localhost:3000/api/cases/<id>/review-requests
curl -b 'dev_actor=bob'   -XPOST localhost:3000/api/cases/<id>/decision \
     -H 'content-type: application/json' -d '{"decision":"approved","rationale":"mine"}'
  → 409  new row for relation "approval" violates check constraint "approval_maker_checker"
curl -b 'dev_actor=alice' -XPOST localhost:3000/api/cases/<id>/decision \
     -H 'content-type: application/json' -d '{"decision":"approved","rationale":"documents match"}'
  → 200  {"case":{"status":"approved"},…}
```

The 409 is the database's own message, passed through. `requested_by` and `decided_by` are read from
the session actor; sending them in the body has no effect.

## Routes

| method | path | action | notes |
|---|---|---|---|
| GET | `/api/me` | read | actor identity + `can` map for the UI |
| GET | `/api/cases` | read | `?status=&riskTier=&page=` — 50 per page, newest first, filtered and paged in SQL |
| GET | `/api/cases/:id` | read | case, approvals, audit history, `can` |
| POST | `/api/cases/:id/review-requests` | write | opens the review; requester is the session actor |
| POST | `/api/cases/:id/decision` | approve | `{decision, rationale}`; decider is the session actor |

Every one is declared with `server.route(...)`; `all_routes_are_registered` covers the rest.

## Tests

`npm test` from the root runs them with the scaffold's; names begin with the acceptance-criterion id
(`AC-1 …`). `apps/kyc/tests/kyc-routes.test.ts` drives the real routes over `inject()` as app_role,
including the 10,000-row pagination case.

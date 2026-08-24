# Refunds dashboard

The refunds app demonstrates a three-screen React/Vite dashboard on the shared
governance scaffold. Agents create requests. Refunds under 10,000 cents can be
completed directly; larger refunds need a review request and a second actor's
approval before they can become approved.

## Run

From the repository root:

```sh
npm install
npm run migrate
npm run seed                 # 50 fixtures by default
npm run seed -- --rows=10000 # load-test fixtures
npm run dev -w apps/refunds
```

Open `http://localhost:5173`. `npm run dev -w apps/refunds` starts the API on
port 3000 and the Vite UI on port 5173. They can also be started separately:

```sh
npm run dev:server -w apps/refunds
npm run dev:ui -w apps/refunds
```

## Development actors

The top-bar switcher selects `alice`, `bob`, or `carol`, writes the
`dev_actor` cookie, and reloads the page. Alice and Bob are reviewers; Carol is
an agent and cannot approve or reject. The API also accepts
`X-Dev-Actor: alice` (or a `dev_actor` cookie) while `NODE_ENV=development`.

The request-review and decision routes use the shared `approval` table. A
reviewer who requests a review cannot approve their own request; the database
maker-checker constraint rejects that attempt and the UI displays the error
verbatim.

## Limitations

Row-level filtering is implemented in the application query builder rather than
Postgres RLS. Production should use RLS, with the scaffold's actor setting as
its policy input. The development actor switcher is a prototype identity layer
and should be replaced with OIDC in production.

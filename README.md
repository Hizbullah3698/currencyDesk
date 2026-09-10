# Currency Desk

Software for running a currency-exchange counter: buying and selling foreign currency against a
customer, tracking who owes what, moving cheques through their lifecycle, running payroll, posting
journal entries, and closing the books with a balance sheet and income statement.

It is a full application, not a UI mock — a React front end, an Express/PostgreSQL API, and a
shared accounting engine both sides compute with. Sign-in is real, and the database is the ledger
of record.

## What it does

- **Currency purchase / sale** — buy and sell foreign currency against a customer, with the rate,
  PKR value and margin worked out as you type. Stock is carried at weighted-average cost, so the
  margin on a sale reflects what that stock actually cost, not just the day's rate.
- **Six currencies, quoted the way dealers quote them** — EUR, USD, AED, AFN, JPY and IRR against
  PKR (strongest to weakest). The first five are worth more than a rupee, so they are quoted
  "PKR per 1 unit" and multiplied; IRR is worth far less, so it is quoted "IRR per 1 PKR" and
  divided, exactly as a dealer would write it. The rate box tells you which convention it wants,
  and every figure downstream is held in one canonical unit so the two can never be mixed up.
- **Real transaction dates** — every trade and every payment records the day the deal was actually
  struck, separately from when it was keyed in. Backdate an entry and it lands in the right
  reporting period; a future date is refused.
- **Customer ledger** — each customer carries a running receivable/payable built from trades,
  receipts, payments and cleared cheques. View a full statement, or the balance as of any past
  date.
- **Cheques** — inward and outward cheques run Pending → Deposited → Cleared/Returned. A
  customer's balance only moves when a cheque actually clears, not when it is received.
- **Chart of accounts** — customers, banks, cash, currency stock, income, expenses, employees and
  payables in one list, each with the fields its type needs. An account's type locks once it has
  been used in a transaction so the books can't be quietly reclassified afterwards; an admin can
  override that if it was miskeyed at entry. Seven core system accounts can never be retyped or
  deleted by anyone — that rule is enforced by the database itself, not just the app.
- **Journal entries** — manual double-entry postings for anything that isn't a standard trade or
  payment.
- **Salary** — accrue per employee per period, then pay it out of a bank account. Accrual and
  payment are always separate entries, so what is owed and what has been paid stay distinguishable.
- **Reports** — a filterable transaction log, a balance sheet, and an income statement showing
  trading margin per currency plus anything journalled to income. All of them print properly:
  fixed light colours regardless of screen theme, tabular figures, and page breaks that don't
  strand a header or split a total.
- **Roles** — Admin has full access; Operator can trade, take payments and deposit cheques, but is
  kept out of the journal, salary, financial reports, and the desk's own cost and profit figures.
  That split is enforced by the server, not just hidden in the UI.

## Tech stack

Three packages in one npm workspaces repo.

| | |
|---|---|
| **Front end** (`frontend/`) | React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router 7, Radix UI primitives, Recharts, Lucide icons |
| **Back end** (`backend/`) | Node + Express, PostgreSQL 16 (`pg`, no ORM), `express-session` with a Postgres-backed store, bcryptjs |
| **Shared** (`packages/engine/`) | `@currencydesk/engine` — the accounting math and domain types, imported by both sides so the client and server can never disagree about how a number is worked out |
| **Tests** | Vitest — engine unit tests, backend integration tests against a real throwaway Postgres database, and frontend report-math tests |

## Getting started

You'll need Node and Docker (for Postgres).

```bash
# 1. Install — MUST be from the repo root, so the workspaces link up
npm install

# 2. Database + backend, from inside backend/
cd backend
docker compose up -d          # local Postgres 16
cp .env.example .env          # first time only
npm run migrate               # create the schema; safe to re-run
npm run seed:demo             # creates two logins and prints their passwords

# 3. Run both servers, from the repo root
cd ..
npm run dev:all
```

The app is then at **http://localhost:5173** and the API at **http://localhost:3001**.

`npm run seed:demo` prints the credentials it created — an admin and an operator account. There is
no sign-up screen by design; accounts are created from the command line:

```bash
npm run create-user -- --email you@example.com --password '…' --role admin --name "Your Name"
npm run set-username          # give an existing account a username to log in with
npm run set-password          # reset an existing account's password
```

You can sign in with either a username or an email address.

## Other commands

```bash
npm run test                  # from the repo root — runs all three suites
npm run dev:all               # frontend + backend together

# inside frontend/
npm run dev                   # Vite dev server alone
npm run build                 # type-check and build for production
npm run preview               # preview the production build
npm run lint                  # oxlint
npm run test                  # frontend unit tests

# inside backend/
npm run dev                   # Express with reload
npm run build && npm start    # production build and run
npm run migrate               # apply pending migrations
npm run test                  # integration tests (creates its own test database)
```

The backend's tests create and use a **separate** `currencydesk_test` database and refuse to run
against anything whose connection string doesn't say `_test`. Always run them via `npm run test`
rather than invoking `vitest` directly.

## Project layout

```
├── packages/engine/     @currencydesk/engine — accounting math + domain types, shared
│   └── src/               engine.ts, currencies.ts, ledger.ts, types.ts
├── frontend/
│   └── src/
│       ├── App.tsx          routes and the admin-only guard
│       ├── index.css         design tokens (light/dark/print), Tailwind entry
│       ├── components/       layout, Radix-based ui primitives, charts
│       ├── lib/              store.tsx (API client + app state), auth, reports, formatting
│       └── pages/            one file per screen
└── backend/
    └── src/
        ├── routes/           /api/auth, /api/state, trades, settlements, cheques,
        │                     journal, salary, accounts
        ├── services/         business logic — one file per route group
        ├── db/migrations/    schema, applied by a small idempotent runner
        └── test/             integration tests
```

## Deployment

Both halves deploy to Vercel as two separate projects — the front end as a static SPA, the back
end as a serverless function — with a managed Postgres behind it. They run on different origins,
so the API needs `FRONTEND_ORIGIN` set to the front end's URL and the front end needs
`VITE_API_BASE_URL` set to the API's. Migrations are not applied automatically on deploy; run
`npm run migrate` against the production database yourself.

**Before changing anything on the deployed system, read `CLAUDE.md`** — most relevantly its
"Two-origin deployment" and "Database and migrations" sections. CSRF protection is a
session-bound token, enforced in production (see the "CSRF" section); the frontend and backend
deploy as two separate Vercel projects on different origins, so the cookie is `SameSite=None`
and the `FRONTEND_ORIGIN` allowlist is load-bearing.

## Notes

`CLAUDE.md` in the repo root is the detailed engineering document: architecture, the API surface
and its guards, transaction and concurrency rules, the currency quote convention, theming rules,
and testing practice. `PROJECT_STATUS.md` carries the running log of what has changed and what is
still open. Both are kept current, and are the better reference if you are changing the code
rather than running it.

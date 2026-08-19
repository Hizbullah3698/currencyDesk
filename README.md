# Currency Desk

A front-end for running a currency exchange counter — buying and selling foreign currency, tracking customer receivables/payables, managing cheques, running payroll, and closing the books with a balance sheet and income statement.

This repo is the UI only. It currently runs entirely in the browser (no server, no database yet) and keeps its data in `localStorage`, which makes it fast to try out but not meant for production use as-is.

## What it does

- **Currency purchase / sale** — buy and sell foreign currency against a customer, with rate, PKR value, and margin calculated automatically. Currency stock is tracked at weighted-average cost, so margin on a sale reflects the real cost of the stock sold, not just the day's rate.
- **Customer ledger** — every customer carries a running receivable/payable balance, built up from trades, receipts, payments, and cleared cheques. You can view any customer's full statement, or the balance as of a past date.
- **Cheques** — inward and outward cheques go through Pending → Deposited → Cleared/Returned. The customer's balance only actually moves once a cheque clears, not when it's received.
- **Accounts / chart of accounts** — customers, banks, cash, currency stock, income, expenses, employees, and payables all live in one accounts list, each with type-appropriate fields. An account's type locks once it's been used in a transaction, so books can't quietly get reclassified after the fact — an admin can still override it if a mistake was made at entry.
- **Journal entries** — manual double-entry postings for anything that doesn't fit a standard trade or payment.
- **Salary** — accrue salary per employee per pay period, then settle it out of a bank account. Accrual and payment are always separate entries so you can see what's owed vs. what's been paid.
- **Reports** — a transaction log with filters, a balance sheet, and an income statement (trading margin by currency plus anything posted through the journal).
- **Roles** — an Admin role with full access, and an Operator role that's blocked from the journal, salary, and financial reports.

## Tech stack

- [React 19](https://react.dev/) + TypeScript
- [Vite](https://vitejs.dev/) for the dev server and build
- [Tailwind CSS v4](https://tailwindcss.com/) for styling
- [React Router](https://reactrouter.com/) for routing
- [Radix UI](https://www.radix-ui.com/) primitives for dialogs, selects, tabs, tooltips, etc.
- [Recharts](https://recharts.org/) for the dashboard charts
- [Lucide](https://lucide.dev/) for icons

## Getting started

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`. Sign in with anything — it's a demo login, and there are "Continue as Admin" / "Continue as User" buttons to try both roles.

Other scripts:

```bash
npm run build     # type-check and build for production
npm run preview   # preview the production build locally
npm run lint       # lint with oxlint
```

## Project layout

```
src/
├── App.tsx              # routes and the admin-only route guard
├── index.css             # design tokens (colors, light/dark) and Tailwind entry
├── components/
│   ├── layout/            # app shell, sidebar, top bar
│   └── ui/                 # button, dialog, select, tabs, etc.
├── lib/
│   ├── store.tsx           # app state + every state-changing action
│   ├── engine.ts            # the actual accounting logic — pure functions
│   ├── reports.ts            # report helpers
│   ├── seed.ts                # demo data
│   └── types.ts                # shared TypeScript types
└── pages/                # one file per screen
```

`store.tsx` is the center of the app — it holds all the data (accounts, activity, cheques, journal entries, currency stock) and exposes functions like `confirmSale`, `confirmPurchase`, `postJournal`, `depositCheque`, and `accrueSalary` that validate input and update state. `engine.ts` is where the actual math and rules live (weighted-average cost, margin calculation, balance-as-of-date, cheque numbering) — kept separate from the store so it doesn't depend on React at all.

## Known limitations

- Data is stored in the browser's `localStorage`, not a real database. Clearing site data wipes the books.
- Login doesn't check a password — it's there to demonstrate the Admin/Operator role split, not to gate real access.
- No automated tests yet.

A proper backend (real auth, a database, and an API) is the natural next step before this could be used for real trading.

# KUR Loan & Account Tracker

A personal KUR tracker built with React + Vite + TypeScript, Vercel serverless
functions, Prisma, Supabase Postgres, and Tailwind.

All data lives in Supabase Postgres. Nothing is kept in `localStorage` or
`IndexedDB`, so clearing the browser never loses anything.

## Run locally

### Zero setup (recommended for just trying it out)

```bash
npm install
npm run dev:local
```

That is the whole thing. `dev:local` starts a **real Postgres** (bundled as an
npm dependency, no Docker and no installer), applies nothing else, and serves
the UI + API on <http://localhost:3000>. The database is created automatically
by `scripts/local-db.mjs`; run `npm run db:migrate` once to create the tables.

Data lives in `.localdb/` (gitignored) and survives restarts. To start over
without touching the cluster itself, run `npm run db:reset`; it clears the
history (installments + transactions) and refuses to run against any host that
is not localhost. Deleting the whole `.localdb/` folder is the heavier reset —
it throws away the database too, after which `npm run db:migrate` recreates it.

To run the database on its own (for `npm run db:migrate`, `prisma studio`, or
`npm run test:db`), use `npm run db:local` in a separate terminal.

### Against Supabase (same database as production)

1. `cp .env.example .env` and fill in `DATABASE_URL` + `DIRECT_URL` from Supabase.
2. `npm install` (runs `prisma generate` automatically)
3. `npx prisma migrate deploy` — creates the tables in Supabase
4. `npm run dev` — runs `vercel dev`, serving the Vite frontend and the
   functions in `api/` on a single port, exactly like production.

`.env.local` takes priority over `.env`, so you can keep Supabase in `.env`
and point `.env.local` at the bundled local database.

To work on the UI alone against a deployed API, set
`VITE_API_URL=https://<app>.vercel.app` in `.env.local` and run
`npm run dev:client`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `vercel dev` — frontend + serverless API together |
| `npm run dev:local` | Same, but without needing a Vercel account |
| `npm run db:local` | Start the bundled local Postgres on its own |
| `npm run db:migrate` | Apply migrations to the local Postgres (`.env.local`) |
| `npm run db:reset` | Wipe all data in the local Postgres (localhost only) |
| `npm run dev:client` | Vite only (needs `VITE_API_URL`) |
| `npm run build` | `prisma generate && vite build` |
| `npm run typecheck` | Type-checks `src/` and `api/` |
| `npm test` | Route wiring tests (no database needed) |
| `npm run test:db` | End-to-end tests against a local Postgres |
| `npm run backup` | Manual JSON snapshot of Supabase into `backup/` |
| `npm run prisma:deploy` | Apply migrations to Supabase |
| `npm run prisma:studio` | Browse the data |

## Testing locally

Two levels, in the order you should run them.

**1. No database required** — checks that every route module loads, dispatches
methods correctly, and never leaks an error message:

```bash
npm test
```

**2. Against a real Postgres** — exercises seeding, top up, installment
payment, deletion rollback, and the remaining-debt rebase, asserting that the
balance and the ledger always agree:

```bash
npm run db:local   # in another terminal; creates the `kur` database
npm run test:db
```

No Docker needed — `db:local` runs the bundled Postgres. If you prefer
Docker:

```bash
docker run -d --name kur-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=kur -p 55432:5432 postgres:16-alpine
cp .env.test.example .env.test
npm run test:db
```

`test:db` applies the migrations to the test database and then runs the suite,
reading `.env.test` on its own — no shell env-var juggling, so it behaves the
same in PowerShell and bash.

These tests `TRUNCATE` every table. Both the migrate step and the suite refuse
to run against any host other than `localhost`, so `.env.test` can never wipe
Supabase.

**3. The whole app.** Two options, both serving the UI and the API on one
origin just like production:

- `npm run dev` — `vercel dev`. Highest fidelity, needs `vercel login`.
- `npm run dev:local` — [scripts/dev-server.mjs](scripts/dev-server.mjs). No
  Vercel account needed; Vite compiles the TypeScript handlers on the fly and
  the route table is spelled out explicitly so any drift from Vercel's own
  routing is visible.

Both read `.env.local` in preference to `.env`, so you can point the app at a
throwaway local database while `.env` keeps your Supabase credentials.

## API

Each file under `api/` is one Vercel serverless function:

| Endpoint | Methods |
|---|---|
| `/api/health` | `GET` |
| `/api/dashboard` | `GET` |
| `/api/setup` | `POST` |
| `/api/topup` | `POST` |
| `/api/pay-installment` | `POST` |
| `/api/set-balance` | `POST` |
| `/api/set-remaining-debt` | `POST` |
| `/api/transactions` | `GET` |
| `/api/transactions/:id` | `PATCH`, `DELETE` |
| `/api/loan-payments` | `GET` |
| `/api/loan-payments/:id` | `PATCH`, `DELETE` |

## Deployment

See [MIGRATION.md](MIGRATION.md) for the full Supabase + Vercel setup, the
environment variables, local-vs-production differences, backup strategy, and
troubleshooting.

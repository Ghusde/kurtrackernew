# KUR Loan & Account Tracker

A personal KUR tracker built with React + Vite + TypeScript, Express, SQLite, Prisma, and Tailwind.

## Run locally

1. Install dependencies: `npm install`
2. Generate Prisma client: `npm run prisma:generate`
3. Create SQLite database and migrate: `npm run prisma:migrate`
4. Start development server: `npm run dev`

## Notes

- The server runs catch-up logic for dashboard, transactions, loan payments, and AI routes.
- Backup files are written to `backup/backup.json` after top up, undo, auto-debit, and shortfall recovery actions.

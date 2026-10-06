/**
 * Pushes the Prisma schema (all migrations) to the REMOTE database described by
 * `.env` and verifies the result end-to-end.
 *
 *   npm run db:deploy
 *
 * This is the "new Supabase project" bootstrap: create the project, paste the
 * two connection strings into `.env`, run this once. It is idempotent —
 * re-running it is a no-op when there are no new migrations.
 *
 * What it does:
 *   1. Validates DATABASE_URL + DIRECT_URL are real (not `.env.example` placeholders)
 *   2. Runs `prisma migrate deploy` (uses DIRECT_URL, port 5432)
 *   3. Connects through DATABASE_URL (port 6543 pooler) exactly like the
 *      serverless functions do, and counts the 4 tables
 *
 * It never prints credentials — hosts are redacted to `//***@`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

if (!existsSync('.env')) {
  console.error('Missing .env. Copy .env.example and fill in your database details first.');
  process.exit(1);
}

// `prisma migrate` reads .env itself; do the same so the verification below sees
// the same values. override:true wins over any stale shell env.
config({ path: '.env', override: true });

const redact = (url) => url.replace(/\/\/[^@]*@/, '//***@');

const PLACEHOLDERS = /\[(PROJECT-REF|PASSWORD|REGION)\]/;

const missing = ['DATABASE_URL', 'DIRECT_URL'].filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Refusing to deploy: ${missing.join(' and ')} not set in .env.`);
  process.exit(1);
}

for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (PLACEHOLDERS.test(process.env[key])) {
    console.error(
      `Refusing to deploy: ${key} still contains .env.example placeholders.\n` +
        'Replace them with the values from your new Supabase project ' +
        '(Project Settings -> Database -> Connection string).'
    );
    process.exit(1);
  }
}

const url = process.env.DATABASE_URL ?? '';
const direct = process.env.DIRECT_URL ?? '';

if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.warn(
    'Warning: DATABASE_URL points at localhost. For the local DB use `npm run db:migrate`.\n'
  );
}

console.log('Deploying schema');
console.log(`  runtime (pooler) ${redact(url)}`);
console.log(`  migrations       ${redact(direct)}`);
console.log('');

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  shell: true
});

if ((result.status ?? 1) !== 0) {
  console.error('\nprisma migrate deploy failed — nothing was verified.');
  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// Verify through the runtime connection (the pooler), the same path the
// Vercel functions use. If this fails, the app would be broken even though the
// migration succeeded over DIRECT_URL.
// ---------------------------------------------------------------------------
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

try {
  await prisma.$queryRawUnsafe('SELECT 1');

  const [loanInfo, loanPayments, accountBalances, accountTransactions] = await Promise.all([
    prisma.loanInfo.count(),
    prisma.loanPayment.count(),
    prisma.accountBalance.count(),
    prisma.accountTransaction.count()
  ]);

  console.log('\nVerified through the runtime connection (pooler).');
  console.log(
    `  loanInfo=${loanInfo} loanPayments=${loanPayments} ` +
      `accountBalances=${accountBalances} accountTransactions=${accountTransactions}`
  );
  console.log('  Schema is live. Open the dashboard — the first load seeds the baseline.');
} catch (error) {
  console.error('\nSchema migrated, but the runtime connection failed:');
  console.error(`  ${error instanceof Error ? error.message : error}`);
  console.error('  Check DATABASE_URL: it must be the transaction pooler (port 6543)');
  console.error('  with ?pgbouncer=true&connection_limit=1 appended.');
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

process.exit(0);

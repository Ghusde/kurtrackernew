/**
 * Wipes every table in the LOCAL development database (.env.local).
 *
 *   npm run db:reset
 *
 * The loan structure is not gone afterwards: `ensureSeedData` recreates the
 * LoanInfo row and the starting balance the next time the dashboard is loaded.
 * What gets cleared is the history — installments and account transactions.
 *
 * Refuses to run against anything that is not localhost, so this can never
 * touch Supabase.
 */
import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

const envFile = process.argv.includes('--test') ? '.env.test' : '.env.local';

if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Copy .env.example and point it at localhost first.`);
  process.exit(1);
}

config({ path: envFile, override: true });

const url = process.env.DATABASE_URL ?? '';
const redacted = url.replace(/\/\/[^@]*@/, '//***@');

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error(`Refusing to reset: ${envFile} must point at a local database.\nGot host: ${redacted}`);
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const before = {
    installments: await prisma.loanPayment.count(),
    transactions: await prisma.accountTransaction.count()
  };

  // One statement, so the FK ordering cannot bite. CASCADE also clears any
  // rows still referencing a loan payment.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AccountTransaction", "LoanPayment", "AccountBalance", "LoanInfo" RESTART IDENTITY CASCADE'
  );

  console.log(`  Database  ${redacted}`);
  console.log(`  Removed   ${before.installments} installment(s), ${before.transactions} transaction(s)`);
  console.log('  Done. The next dashboard load recreates the loan structure.');
} catch (error) {
  console.error('Reset failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

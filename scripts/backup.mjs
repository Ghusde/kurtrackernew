/**
 * Manual off-site snapshot of the Supabase data.
 *
 *   npm run backup
 *
 * This is NOT part of the serverless app — Vercel functions have a read-only
 * filesystem, so the old server-side backup/backup.json write is gone.
 * Supabase itself is the source of truth; this script only produces an extra
 * local copy you can archive. Run it from your machine whenever you want one.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

try {
  const [loanInfo, loanPayments, accountBalances, accountTransactions] = await Promise.all([
    prisma.loanInfo.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } }),
    prisma.accountBalance.findMany(),
    prisma.accountTransaction.findMany({ orderBy: { transactionDate: 'asc' } })
  ]);

  const dir = path.join(process.cwd(), 'backup');
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `backup-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ exportedAt: new Date().toISOString(), loanInfo, loanPayments, accountBalances, accountTransactions }, null, 2)
  );

  console.log(`Saved ${file}`);
  console.log(
    `  loanInfo=${loanInfo.length} loanPayments=${loanPayments.length} ` +
      `accountBalances=${accountBalances.length} accountTransactions=${accountTransactions.length}`
  );
} finally {
  await prisma.$disconnect();
}

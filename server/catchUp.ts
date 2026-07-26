import { prisma } from './prisma.js';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backupDir = path.join(__dirname, '..', 'backup');
mkdirSync(backupDir, { recursive: true });

async function backupData() {
  const loanInfo = await prisma.loanInfo.findFirst();
  const loanPayments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } });
  const accountTransactions = await prisma.accountTransaction.findMany({ orderBy: { transactionDate: 'asc' } });

  writeFileSync(
    path.join(backupDir, 'backup.json'),
    JSON.stringify({ loanInfo, loanPayments, accountTransactions }, null, 2)
  );
}

export async function runCatchUp() {
  const today = new Date();
  const loanInfo = await prisma.loanInfo.findFirst();
  if (!loanInfo) {
    return { ok: true, message: 'No loan info configured yet.' };
  }

  const balance = await prisma.accountBalance.findFirst();
  let currentBalance = balance?.currentBalance ?? loanInfo.disbursedAmount;

  if (!balance) {
    await prisma.accountBalance.create({
      data: {
        currentBalance,
        updatedAt: new Date()
      }
    });
  }

  const existingPayments = await prisma.loanPayment.findMany({
    where: { loanInfoId: loanInfo.id },
    orderBy: { monthNumber: 'asc' }
  });
  const existingMonths = new Set(existingPayments.map((payment) => payment.monthNumber));

  const startDate = new Date(loanInfo.startDate);
  const monthsToGenerate: Array<{ monthNumber: number; dueDate: Date }> = [];
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 25);

  while (cursor <= today) {
    const monthNumber = monthsToGenerate.length + 1;
    monthsToGenerate.push({ monthNumber, dueDate: new Date(cursor) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 25);
  }

  for (const item of monthsToGenerate) {
    if (existingMonths.has(item.monthNumber)) continue;

    const amountDue = loanInfo.monthlyInstallment;
    let amountPaid = 0;
    let shortfallAmount = 0;
    let status = 'lunas';

    if (currentBalance > 0) {
      amountPaid = Math.min(currentBalance, amountDue);
      currentBalance -= amountPaid;
      if (amountPaid < amountDue) {
        shortfallAmount = amountDue - amountPaid;
        status = 'gagal_debit';
      }
    } else {
      shortfallAmount = amountDue;
      status = 'gagal_debit';
    }

    const payment = await prisma.loanPayment.create({
      data: {
        loanInfoId: loanInfo.id,
        monthNumber: item.monthNumber,
        dueDate: item.dueDate,
        amountDue,
        amountPaid,
        status,
        shortfallAmount,
        generatedAt: new Date()
      }
    });

    if (amountPaid > 0) {
      await prisma.accountTransaction.create({
        data: {
          transactionDate: item.dueDate,
          type: 'debit_cicilan',
          amount: amountPaid,
          resultingBalance: currentBalance,
          relatedLoanPaymentId: payment.id,
          note: `Cicilan bulan ${item.monthNumber}`,
          isUndone: false
        }
      });
    }

    await prisma.accountBalance.updateMany({
      data: {
        currentBalance,
        updatedAt: new Date()
      }
    });
  }

  await backupData();
  return { ok: true, message: 'Catch-up completed.' };
}

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

// Fixed monthly installment amount and the highest remaining-debt value the
// "Remaining KUR Debt" field can be edited to.
export const MONTHLY_INSTALLMENT = 2348333;
export const MAX_REMAINING_DEBT = 120000000;

/** Accepts either the root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);
}

export async function ensureSeedData(db: Db = prisma) {
  let loanInfo = await db.loanInfo.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!loanInfo) {
    loanInfo = await db.loanInfo.create({
      data: {
        plafond: 100000000,
        disbursedAmount: 95000000,
        monthlyInstallment: MONTHLY_INSTALLMENT,
        tenorMonths: 48,
        startDate: new Date('2026-01-25')
      }
    });
  } else if (loanInfo.monthlyInstallment !== MONTHLY_INSTALLMENT) {
    // Keep the existing record in sync with the fixed installment amount
    // (covers records created before this value was corrected).
    loanInfo = await db.loanInfo.update({
      where: { id: loanInfo.id },
      data: { monthlyInstallment: MONTHLY_INSTALLMENT }
    });
  }

  const balance = await db.accountBalance.findFirst({ orderBy: { updatedAt: 'asc' } });
  if (!balance) {
    await db.accountBalance.create({
      data: {
        currentBalance: loanInfo.disbursedAmount,
        updatedAt: new Date()
      }
    });
  }

  return loanInfo;
}

export async function adjustBalance(db: Db, delta: number) {
  const balance = await db.accountBalance.findFirst();
  if (!balance) throw new Error('Account balance missing.');
  const currentBalance = balance.currentBalance + delta;
  await db.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  return currentBalance;
}

export const transactionDelta = (type: string, amount: number) =>
  type === 'topup' ? amount : -amount;

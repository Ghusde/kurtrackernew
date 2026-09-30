import { createHandler } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { ensureSeedData } from './_lib/core.js';

export default createHandler({
  GET: async (_req, res) => {
    await ensureSeedData();

    const loanInfo = await prisma.loanInfo.findFirst();
    const payments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'desc' }, take: 5 });
    const transactions = await prisma.accountTransaction.findMany({
      orderBy: { transactionDate: 'desc' },
      take: 5
    });
    const balance = await prisma.accountBalance.findFirst();

    if (!loanInfo || !balance) {
      res.json({ loanInfo: null, balance: null, payments: [], transactions: [] });
      return;
    }

    const paidAggregate = await prisma.loanPayment.aggregate({
      where: { loanInfoId: loanInfo.id },
      _sum: { amountPaid: true },
      _count: { _all: true }
    });
    const totalPaid = paidAggregate._sum.amountPaid ?? 0;
    const remainingDebt = Math.max(0, loanInfo.plafond - totalPaid + loanInfo.debtAdjustment);
    const paidPercent = ((loanInfo.plafond - remainingDebt) / loanInfo.plafond) * 100;
    const monthProgress = paidAggregate._count._all;

    res.json({
      loanInfo,
      balance,
      remainingDebt,
      paidPercent,
      monthProgress,
      tenorMonths: loanInfo.tenorMonths,
      payments,
      transactions
    });
  }
});

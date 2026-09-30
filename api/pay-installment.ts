import { createHandler } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { ensureSeedData, formatCurrency } from './_lib/core.js';

export default createHandler({
  POST: async (_req, res) => {
    // Balance check, payment row, ledger row and balance update all land
    // together — a partial write here would corrupt the running balance.
    const outcome = await prisma.$transaction(async (tx) => {
      await ensureSeedData(tx);

      const loanInfo = await tx.loanInfo.findFirst();
      const balance = await tx.accountBalance.findFirst();
      if (!loanInfo || !balance) {
        return { error: 'Loan setup missing.' } as const;
      }

      const paidNow = new Date();
      const amount = loanInfo.monthlyInstallment;

      if (balance.currentBalance < amount) {
        return {
          error: `Insufficient account balance. Need ${formatCurrency(amount)}, current balance ${formatCurrency(balance.currentBalance)}.`
        } as const;
      }

      const currentBalance = balance.currentBalance - amount;

      const lastPayment = await tx.loanPayment.findFirst({
        where: { loanInfoId: loanInfo.id },
        orderBy: { monthNumber: 'desc' }
      });
      const monthNumber = (lastPayment?.monthNumber ?? 0) + 1;

      if (monthNumber > loanInfo.tenorMonths) {
        return { error: 'All installments have been paid.' } as const;
      }

      const created = await tx.loanPayment.create({
        data: {
          loanInfoId: loanInfo.id,
          monthNumber,
          dueDate: paidNow,
          amountDue: amount,
          amountPaid: amount,
          status: 'paid',
          shortfallAmount: 0,
          generatedAt: paidNow
        }
      });

      await tx.accountTransaction.create({
        data: {
          transactionDate: paidNow,
          type: 'installment_debit',
          amount,
          resultingBalance: currentBalance,
          relatedLoanPaymentId: created.id,
          note: `Installment month ${monthNumber}`
        }
      });

      await tx.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });

      return { message: `Installment month ${monthNumber} paid ${formatCurrency(amount)}.` } as const;
    });

    if ('error' in outcome) {
      res.status(400).json({ error: outcome.error });
      return;
    }

    res.json({ ok: true, message: outcome.message });
  }
});

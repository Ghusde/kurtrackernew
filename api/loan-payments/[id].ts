import { createHandler, param, readBody } from '../_lib/http.js';
import { prisma } from '../_lib/prisma.js';
import { adjustBalance, ensureSeedData, transactionDelta } from '../_lib/core.js';

export default createHandler({
  PATCH: async (req, res) => {
    const id = param(req, 'id');
    const { amountDue, amountPaid, dueDate, monthNumber } = readBody<{
      amountDue: number;
      amountPaid: number;
      dueDate: string;
      monthNumber: number;
    }>(req);

    for (const value of [amountDue, amountPaid]) {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        res.status(400).json({ error: 'Invalid installment amount.' });
        return;
      }
    }
    if (monthNumber !== undefined && (!Number.isInteger(monthNumber) || monthNumber < 1)) {
      res.status(400).json({ error: 'Invalid month number.' });
      return;
    }

    await ensureSeedData();
    const payment = await prisma.loanPayment.findUnique({ where: { id } });
    if (!payment) {
      res.status(404).json({ error: 'Installment not found.' });
      return;
    }

    const updated = await prisma.loanPayment.update({
      where: { id: payment.id },
      data: {
        monthNumber: monthNumber ?? payment.monthNumber,
        amountDue: amountDue ?? payment.amountDue,
        amountPaid: amountPaid ?? payment.amountPaid,
        shortfallAmount: 0,
        status: 'paid',
        dueDate: dueDate ? new Date(dueDate) : payment.dueDate
      }
    });

    res.json({ ok: true, message: 'Installment updated.', payment: updated });
  },

  DELETE: async (req, res) => {
    const id = param(req, 'id');

    const outcome = await prisma.$transaction(async (tx) => {
      await ensureSeedData(tx);
      const payment = await tx.loanPayment.findUnique({ where: { id } });
      if (!payment) return { notFound: true } as const;

      const relatedTransactions = await tx.accountTransaction.findMany({
        where: { relatedLoanPaymentId: payment.id }
      });
      for (const transaction of relatedTransactions) {
        await adjustBalance(tx, -transactionDelta(transaction.type, transaction.amount));
      }

      await tx.accountTransaction.deleteMany({ where: { relatedLoanPaymentId: payment.id } });
      await tx.loanPayment.delete({ where: { id: payment.id } });
      return { deleted: true } as const;
    });

    if ('notFound' in outcome) {
      res.status(404).json({ error: 'Installment not found.' });
      return;
    }

    res.json({ ok: true, message: 'Installment deleted.' });
  }
});

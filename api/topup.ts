import { createHandler, readBody } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { ensureSeedData } from './_lib/core.js';

export default createHandler({
  POST: async (req, res) => {
    const { amount, note } = readBody<{ amount: number; note: string }>(req);

    const topUpAmount = Number(amount);
    if (!Number.isFinite(topUpAmount) || topUpAmount <= 0) {
      res.status(400).json({ error: 'Invalid top up amount.' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await ensureSeedData(tx);
      const loanInfo = await tx.loanInfo.findFirst();
      const balance = await tx.accountBalance.findFirst();
      if (!loanInfo || !balance) return null;

      const currentBalance = balance.currentBalance + topUpAmount;
      const transaction = await tx.accountTransaction.create({
        data: {
          transactionDate: new Date(),
          type: 'topup',
          amount: topUpAmount,
          resultingBalance: currentBalance,
          relatedLoanPaymentId: null,
          note: note ?? null
        }
      });

      await tx.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
      return transaction;
    });

    if (!result) {
      res.status(400).json({ error: 'Loan setup missing.' });
      return;
    }

    res.json({ ok: true, transactions: [result] });
  }
});

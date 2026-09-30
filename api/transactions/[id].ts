import { createHandler, param, readBody } from '../_lib/http.js';
import { prisma } from '../_lib/prisma.js';
import { adjustBalance, ensureSeedData, transactionDelta } from '../_lib/core.js';

export default createHandler({
  PATCH: async (req, res) => {
    const id = param(req, 'id');
    const { amount, note, transactionDate } = readBody<{
      amount: number;
      note: string | null;
      transactionDate: string;
    }>(req);

    if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) {
      res.status(400).json({ error: 'Invalid transaction amount.' });
      return;
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await ensureSeedData(tx);
      const transaction = await tx.accountTransaction.findUnique({ where: { id } });
      if (!transaction) return { notFound: true } as const;

      let resultingBalance = transaction.resultingBalance;
      if (amount !== undefined && amount !== transaction.amount) {
        resultingBalance = await adjustBalance(
          tx,
          transactionDelta(transaction.type, amount) - transactionDelta(transaction.type, transaction.amount)
        );
      }

      const updated = await tx.accountTransaction.update({
        where: { id: transaction.id },
        data: {
          amount: amount ?? transaction.amount,
          note: note === undefined ? transaction.note : note,
          transactionDate: transactionDate ? new Date(transactionDate) : transaction.transactionDate,
          resultingBalance
        }
      });

      return { updated } as const;
    });

    if ('notFound' in outcome) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }

    res.json({ ok: true, message: 'Transaction updated.', transaction: outcome.updated });
  },

  DELETE: async (req, res) => {
    const id = param(req, 'id');

    const outcome = await prisma.$transaction(async (tx) => {
      await ensureSeedData(tx);
      const transaction = await tx.accountTransaction.findUnique({ where: { id } });
      if (!transaction) return { notFound: true } as const;

      await adjustBalance(tx, -transactionDelta(transaction.type, transaction.amount));
      await tx.accountTransaction.delete({ where: { id: transaction.id } });
      return { deleted: true } as const;
    });

    if ('notFound' in outcome) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }

    res.json({ ok: true, message: 'Transaction deleted.' });
  }
});

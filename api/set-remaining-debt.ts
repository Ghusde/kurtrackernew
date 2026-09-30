import { createHandler, readBody } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { MAX_REMAINING_DEBT, ensureSeedData, formatCurrency } from './_lib/core.js';

export default createHandler({
  POST: async (req, res) => {
    await ensureSeedData();
    const { remainingDebt } = readBody<{ remainingDebt: number }>(req);

    if (typeof remainingDebt !== 'number' || !Number.isFinite(remainingDebt) || remainingDebt < 0) {
      res.status(400).json({ error: 'Invalid remaining debt amount.' });
      return;
    }

    if (remainingDebt > MAX_REMAINING_DEBT) {
      res.status(400).json({ error: `Remaining debt cannot exceed ${formatCurrency(MAX_REMAINING_DEBT)}.` });
      return;
    }

    const loanInfo = await prisma.loanInfo.findFirst();
    if (!loanInfo) {
      res.status(400).json({ error: 'Loan setup missing.' });
      return;
    }

    const paidAggregate = await prisma.loanPayment.aggregate({
      where: { loanInfoId: loanInfo.id },
      _sum: { amountPaid: true }
    });
    const totalPaid = paidAggregate._sum.amountPaid ?? 0;

    // The progress bar's paid-percentage is (plafond - remainingDebt) / plafond.
    // If the edited remaining debt goes above the current plafond (e.g. the
    // debt basis itself grew, up to the 120jt ceiling), raise the plafond to
    // match so the percentage always stays consistent with whatever value was
    // just entered, instead of going negative or ignoring the edit.
    const newPlafond = Math.max(loanInfo.plafond, remainingDebt);
    const debtAdjustment = remainingDebt - (newPlafond - totalPaid);

    await prisma.loanInfo.update({
      where: { id: loanInfo.id },
      data: { plafond: newPlafond, debtAdjustment }
    });

    res.json({ ok: true, message: `Remaining debt updated to ${formatCurrency(remainingDebt)}.` });
  }
});

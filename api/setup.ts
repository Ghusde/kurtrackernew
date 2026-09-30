import { createHandler, readBody } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { MONTHLY_INSTALLMENT } from './_lib/core.js';

type SetupPayload = {
  plafon: number;
  disbursedAmount: number;
  monthlyInstallment: number;
  tenorMonths: number;
  startDate: string;
  /** Required to create a second loan once one already exists. */
  force: boolean;
};

export default createHandler({
  POST: async (req, res) => {
    const payload = readBody<SetupPayload>(req);

    // Bootstrap-only endpoint. Guarded because a stray second call would leave
    // two LoanInfo rows and two balances in Supabase, and the dashboard's
    // findFirst() would then read from an arbitrary one.
    const existing = await prisma.loanInfo.findFirst();
    if (existing && payload.force !== true) {
      res.status(409).json({
        error: 'Loan setup already exists. Send { "force": true } to create another one.'
      });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const loanInfo = await tx.loanInfo.create({
        data: {
          plafond: Number(payload.plafon ?? 100000000),
          disbursedAmount: Number(payload.disbursedAmount ?? 95000000),
          monthlyInstallment: Number(payload.monthlyInstallment ?? MONTHLY_INSTALLMENT),
          tenorMonths: Number(payload.tenorMonths ?? 48),
          startDate: new Date(payload.startDate ?? '2026-01-25')
        }
      });

      await tx.accountBalance.create({
        data: {
          currentBalance: loanInfo.disbursedAmount,
          updatedAt: new Date()
        }
      });

      return loanInfo;
    });

    res.json({ ok: true, loanInfo: created });
  }
});

import { createHandler, readBody } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { ensureSeedData } from './_lib/core.js';

export default createHandler({
  POST: async (req, res) => {
    await ensureSeedData();
    const { balance } = readBody<{ balance: number }>(req);

    if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) {
      res.status(400).json({ error: 'Invalid balance value.' });
      return;
    }

    const updated = await prisma.accountBalance.updateMany({
      data: { currentBalance: balance, updatedAt: new Date() }
    });

    res.json({ ok: updated.count > 0 });
  }
});

import { createHandler } from '../_lib/http.js';
import { prisma } from '../_lib/prisma.js';
import { ensureSeedData } from '../_lib/core.js';

export default createHandler({
  GET: async (_req, res) => {
    await ensureSeedData();
    const transactions = await prisma.accountTransaction.findMany({
      orderBy: { transactionDate: 'desc' }
    });
    res.json(transactions);
  }
});

import { createHandler } from '../_lib/http.js';
import { prisma } from '../_lib/prisma.js';
import { ensureSeedData } from '../_lib/core.js';

export default createHandler({
  GET: async (_req, res) => {
    await ensureSeedData();
    const payments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } });
    res.json(payments);
  }
});

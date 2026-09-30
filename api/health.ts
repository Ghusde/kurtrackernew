import { createHandler } from './_lib/http.js';
import { prisma } from './_lib/prisma.js';

export default createHandler({
  GET: async (_req, res) => {
    // Also proves the Supabase connection works, not just that the function boots.
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'connected', time: new Date().toISOString() });
  }
});

import { PrismaClient } from '@prisma/client';

// One PrismaClient per warm serverless instance. Without the globalThis cache
// every hot reload (vercel dev) or module re-evaluation would open a new pool
// against Supabase and eventually exhaust the connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error']
  });

globalForPrisma.prisma = prisma;

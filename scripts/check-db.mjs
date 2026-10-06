/**
 * Layer-by-layer database health check for the configuration in `.env`.
 *
 *   npm run db:check
 *
 * Tests each layer independently so a failure tells you exactly WHERE it broke:
 *   1. DNS      — does the hostname resolve?
 *   2. TCP      — is the port reachable?
 *   3. DATABASE_URL  (transaction pooler 6543) — the path Vercel functions use
 *   4. DIRECT_URL    (session pooler 5432)     — the path `prisma migrate` uses
 *   5. Schema   — do the tables exist on the runtime connection?
 *
 * Read-only: it never writes, migrates, or truncates anything.
 */
import { existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { createConnection } from 'node:net';
import { config } from 'dotenv';

const PLACEHOLDERS = /\[(PROJECT-REF|PASSWORD|REGION)\]/;

if (!existsSync('.env')) {
  console.error('Missing .env. Nothing to check.');
  process.exit(1);
}

config({ path: '.env', override: true });

const redact = (url) => url.replace(/\/\/[^@]*@/, '//***@');

function parse(key) {
  const raw = process.env[key] ?? '';
  if (!raw || PLACEHOLDERS.test(raw)) return null;
  try {
    const u = new URL(raw);
    return { raw, host: u.hostname, port: Number(u.port || 5432) };
  } catch {
    return null;
  }
}

const database = parse('DATABASE_URL');
const direct = parse('DIRECT_URL');

if (!database || !direct) {
  console.error('DATABASE_URL and DIRECT_URL must both be set in .env (no placeholders).');
  console.error(`  DATABASE_URL ${database ? 'ok' : 'MISSING/PLACEHOLDER'}`);
  console.error(`  DIRECT_URL   ${direct ? 'ok' : 'MISSING/PLACEHOLDER'}`);
  process.exit(1);
}

let failures = 0;
const pass = (label, detail = '') => console.log(`  OK    ${label.padEnd(26)} ${detail}`);
const fail = (label, detail) => {
  failures += 1;
  console.log(`  FAIL  ${label.padEnd(26)} ${detail}`);
};

console.log(`env: ${redact(database.raw)}\n`);

// --- 1. DNS ---------------------------------------------------------------
console.log('1. DNS');
for (const [label, host] of [
  ['DATABASE_URL host', database.host],
  ['DIRECT_URL host', direct.host]
]) {
  try {
    const { address } = await lookup(host);
    pass(label, `${host} -> ${address}`);
  } catch {
    fail(label, `${host} -> does not resolve`);
  }
}

// --- 2. TCP ---------------------------------------------------------------
console.log('\n2. TCP');
const tcp = (host, port) =>
  new Promise((resolveTcp) => {
    const socket = createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolveTcp(ok);
    };
    socket.setTimeout(8000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

for (const [label, target] of [
  ['DATABASE_URL port', database],
  ['DIRECT_URL port', direct]
]) {
  // Only skip when DNS already failed — otherwise the TCP result is meaningless.
  const reachable = await tcp(target.host, target.port);
  if (reachable) pass(label, `${target.host}:${target.port}`);
  else fail(label, `${target.host}:${target.port} unreachable`);
}

// --- 3 + 4 + 5. Prisma auth on each connection ----------------------------
const { PrismaClient } = await import('@prisma/client');

const describe = (error) => {
  const e = error;
  const code = e?.code ?? e?.errorCode;
  const last = (e instanceof Error ? e.message : String(e))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return `${code ? `${code}: ` : ''}${last ?? 'unknown error'}`;
};

async function probe(label, url) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    pass(label, 'authenticated (SELECT 1)');
    return prisma;
  } catch (error) {
    fail(label, describe(error));
    await prisma.$disconnect().catch(() => {});
    return null;
  }
}

console.log('\n3/4. Auth');
const runtime = await probe('DATABASE_URL (6543)', database.raw);
const migration = await probe('DIRECT_URL (5432)', direct.raw);

// --- 5. Schema ------------------------------------------------------------
console.log('\n5. Schema');
if (runtime) {
  try {
    const counts = {
      loanInfo: await runtime.loanInfo.count(),
      loanPayments: await runtime.loanPayment.count(),
      accountBalances: await runtime.accountBalance.count(),
      accountTransactions: await runtime.accountTransaction.count()
    };
    pass('tables', JSON.stringify(counts));
    console.log('\n  Note: 0 rows is fine — the first dashboard load seeds the baseline.');
  } catch (error) {
    fail('tables', `missing or unmigrated — ${describe(error)}`);
    console.log('\n  Fix: run `npm run db:deploy` to create the schema.');
  }
} else {
  fail('tables', 'skipped — no runtime connection');
}

await runtime?.$disconnect().catch(() => {});
await migration?.$disconnect().catch(() => {});

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);

/**
 * End-to-end test of the serverless handlers against a REAL Postgres.
 *
 * Skipped unless RUN_DB_TESTS=1. See README "Testing against a real database".
 *
 *   docker run -d --name kur-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=kur \
 *     -p 55432:5432 postgres:16-alpine
 *   npm run test:db
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../api/_lib/prisma.js';
import { MONTHLY_INSTALLMENT } from '../api/_lib/core.js';
import dashboard from '../api/dashboard.js';
import topup from '../api/topup.js';
import payInstallment from '../api/pay-installment.js';
import setBalance from '../api/set-balance.js';
import setRemainingDebt from '../api/set-remaining-debt.js';
import transactions from '../api/transactions/index.js';
import transactionById from '../api/transactions/[id].js';
import loanPayments from '../api/loan-payments/index.js';
import { mockReq, mockRes } from './helpers.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const url = process.env.DATABASE_URL ?? '';

// Hard guard: these tests TRUNCATE every table. Refuse to touch anything that
// is not an explicitly local database, so a stray DATABASE_URL pointing at
// Supabase can never wipe real data.
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (enabled && !isLocal) {
  throw new Error(
    `Refusing to run destructive DB tests against a non-local DATABASE_URL.\n` +
      `Point DATABASE_URL at localhost first. Got host: ${url.replace(/\/\/[^@]*@/, '//***@')}`
  );
}

type DashboardBody = {
  loanInfo: { plafond: number; monthlyInstallment: number; tenorMonths: number };
  balance: { currentBalance: number };
  remainingDebt: number;
  paidPercent: number;
  monthProgress: number;
};

describe.runIf(enabled)('serverless handlers against real Postgres', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AccountTransaction", "LoanPayment", "AccountBalance", "LoanInfo" CASCADE'
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds loan info and balance on the first dashboard read', async () => {
    const res = mockRes();
    await dashboard(mockReq('GET'), res);

    const body = res.body as DashboardBody;
    expect(res.statusCode).toBe(200);
    expect(body.loanInfo.plafond).toBe(100000000);
    expect(body.loanInfo.monthlyInstallment).toBe(MONTHLY_INSTALLMENT);
    expect(body.balance.currentBalance).toBe(95000000);
    expect(body.remainingDebt).toBe(100000000);
    expect(body.monthProgress).toBe(0);
  });

  it('credits a top up and records it in the ledger', async () => {
    await dashboard(mockReq('GET'), mockRes());

    const res = mockRes();
    await topup(mockReq('POST', { amount: 5000000, note: 'gaji' }), res);
    expect(res.body).toMatchObject({ ok: true });

    const after = mockRes();
    await dashboard(mockReq('GET'), after);
    expect((after.body as DashboardBody).balance.currentBalance).toBe(100000000);

    const list = mockRes();
    await transactions(mockReq('GET'), list);
    const rows = list.body as Array<{ type: string; amount: number; resultingBalance: number; note: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'topup',
      amount: 5000000,
      resultingBalance: 100000000,
      note: 'gaji'
    });
  });

  it('rejects an invalid top up without writing anything', async () => {
    await dashboard(mockReq('GET'), mockRes());

    for (const amount of [0, -1, 'abc']) {
      const res = mockRes();
      await topup(mockReq('POST', { amount }), res);
      expect(res.statusCode).toBe(400);
    }

    const list = mockRes();
    await transactions(mockReq('GET'), list);
    expect(list.body).toEqual([]);
  });

  it('debits an installment, advances progress, and links the ledger row', async () => {
    await dashboard(mockReq('GET'), mockRes());

    const res = mockRes();
    await payInstallment(mockReq('POST'), res);
    expect(res.body).toMatchObject({ ok: true });
    expect((res.body as { message: string }).message).toContain('month 1');

    const after = mockRes();
    await dashboard(mockReq('GET'), after);
    const body = after.body as DashboardBody;
    expect(body.balance.currentBalance).toBe(95000000 - MONTHLY_INSTALLMENT);
    expect(body.remainingDebt).toBe(100000000 - MONTHLY_INSTALLMENT);
    expect(body.monthProgress).toBe(1);

    const payments = mockRes();
    await loanPayments(mockReq('GET'), payments);
    const rows = payments.body as Array<{ monthNumber: number; status: string; amountPaid: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ monthNumber: 1, status: 'paid', amountPaid: MONTHLY_INSTALLMENT });

    const ledger = mockRes();
    await transactions(mockReq('GET'), ledger);
    const txRows = ledger.body as Array<{ type: string; relatedLoanPaymentId: string | null }>;
    expect(txRows[0].type).toBe('installment_debit');
    expect(txRows[0].relatedLoanPaymentId).toBeTruthy();
  });

  it('refuses an installment the balance cannot cover, leaving state untouched', async () => {
    await dashboard(mockReq('GET'), mockRes());
    await setBalance(mockReq('POST', { balance: 1000 }), mockRes());

    const res = mockRes();
    await payInstallment(mockReq('POST'), res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('Insufficient');

    const payments = mockRes();
    await loanPayments(mockReq('GET'), payments);
    expect(payments.body).toEqual([]);

    const after = mockRes();
    await dashboard(mockReq('GET'), after);
    expect((after.body as DashboardBody).balance.currentBalance).toBe(1000);
  });

  it('rolls the balance back when a transaction is deleted', async () => {
    await dashboard(mockReq('GET'), mockRes());
    await topup(mockReq('POST', { amount: 5000000 }), mockRes());

    const list = mockRes();
    await transactions(mockReq('GET'), list);
    const id = (list.body as Array<{ id: string }>)[0].id;

    const del = mockRes();
    await transactionById(mockReq('DELETE', undefined, { id }), del);
    expect(del.body).toMatchObject({ ok: true });

    const after = mockRes();
    await dashboard(mockReq('GET'), after);
    expect((after.body as DashboardBody).balance.currentBalance).toBe(95000000);
  });

  it('re-bases the plafond when the remaining debt is edited upward', async () => {
    await dashboard(mockReq('GET'), mockRes());

    const res = mockRes();
    await setRemainingDebt(mockReq('POST', { remainingDebt: 110000000 }), res);
    expect(res.body).toMatchObject({ ok: true });

    const after = mockRes();
    await dashboard(mockReq('GET'), after);
    const body = after.body as DashboardBody;
    expect(body.remainingDebt).toBe(110000000);
    expect(body.loanInfo.plafond).toBe(110000000);
    expect(body.paidPercent).toBe(0);
  });

  it('enforces the remaining-debt ceiling', async () => {
    await dashboard(mockReq('GET'), mockRes());

    const res = mockRes();
    await setRemainingDebt(mockReq('POST', { remainingDebt: 120000001 }), res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('cannot exceed');
  });

  it('keeps the ledger and the balance in agreement across a mixed sequence', async () => {
    await dashboard(mockReq('GET'), mockRes());
    await topup(mockReq('POST', { amount: 10000000 }), mockRes());
    await payInstallment(mockReq('POST'), mockRes());
    await topup(mockReq('POST', { amount: 2000000 }), mockRes());
    await payInstallment(mockReq('POST'), mockRes());

    const expected = 95000000 + 10000000 - MONTHLY_INSTALLMENT + 2000000 - MONTHLY_INSTALLMENT;

    const after = mockRes();
    await dashboard(mockReq('GET'), after);
    const body = after.body as DashboardBody;
    expect(body.balance.currentBalance).toBe(expected);
    expect(body.monthProgress).toBe(2);

    // The newest ledger row's resultingBalance must equal the stored balance.
    const ledger = mockRes();
    await transactions(mockReq('GET'), ledger);
    const rows = ledger.body as Array<{ resultingBalance: number }>;
    expect(rows).toHaveLength(4);
    expect(rows[0].resultingBalance).toBe(expected);
  });
});

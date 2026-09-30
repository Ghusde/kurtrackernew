import { describe, expect, it, vi } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { createHandler, param, readBody } from '../api/_lib/http.js';
import { formatCurrency, transactionDelta } from '../api/_lib/core.js';
import dashboard from '../api/dashboard.js';
import topup from '../api/topup.js';
import setBalance from '../api/set-balance.js';
import payInstallment from '../api/pay-installment.js';
import setRemainingDebt from '../api/set-remaining-debt.js';
import setup from '../api/setup.js';
import health from '../api/health.js';
import transactions from '../api/transactions/index.js';
import transactionById from '../api/transactions/[id].js';
import loanPayments from '../api/loan-payments/index.js';
import loanPaymentById from '../api/loan-payments/[id].js';
import { mockReq as req, mockRes } from './helpers.js';

describe('every route is a Vercel handler', () => {
  const routes = {
    health,
    dashboard,
    setup,
    topup,
    payInstallment,
    setBalance,
    setRemainingDebt,
    transactions,
    transactionById,
    loanPayments,
    loanPaymentById
  };

  it.each(Object.keys(routes))('%s exports a default function', (name) => {
    expect(typeof routes[name as keyof typeof routes]).toBe('function');
  });
});

describe('method dispatch', () => {
  it('rejects a wrong method with 405 and an Allow header, without touching the DB', async () => {
    const res = mockRes();
    await dashboard(req('DELETE'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(res.body).toEqual({ error: 'Method DELETE not allowed.' });
  });

  it('rejects GET on write-only routes', async () => {
    for (const handler of [topup, payInstallment, setBalance, setRemainingDebt, setup]) {
      const res = mockRes();
      await handler(req('GET'), res);
      expect(res.statusCode).toBe(405);
    }
  });

  it('marks every response as uncacheable', async () => {
    const res = mockRes();
    await transactions(req('POST'), res);
    expect(res.headers['Cache-Control']).toBe('no-store, max-age=0');
  });

  it('allows PATCH and DELETE on the id routes', async () => {
    for (const handler of [transactionById, loanPaymentById]) {
      const res = mockRes();
      await handler(req('PUT', undefined, { id: 'x' }), res);
      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toBe('PATCH, DELETE');
    }
  });
});

describe('createHandler', () => {
  it('converts a thrown error into a 500 without leaking the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createHandler({
      GET: async () => {
        throw new Error('connection string leaked');
      }
    });
    const res = mockRes();
    await handler(req('GET'), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error.' });
    spy.mockRestore();
  });
});

describe('body and query parsing', () => {
  it('accepts objects, JSON strings, and missing bodies', () => {
    expect(readBody(req('POST', { amount: 5 }))).toEqual({ amount: 5 });
    expect(readBody(req('POST', '{"amount":5}'))).toEqual({ amount: 5 });
    expect(readBody(req('POST', undefined))).toEqual({});
    expect(readBody(req('POST', 'not json'))).toEqual({});
  });

  it('normalises repeated query params to a single string', () => {
    expect(param(req('GET', undefined, { id: 'abc' }), 'id')).toBe('abc');
    expect(param({ query: { id: ['a', 'b'] } } as unknown as VercelRequest, 'id')).toBe('a');
    expect(param(req('GET'), 'id')).toBe('');
  });
});

describe('ledger maths carried over from the Express server', () => {
  it('credits top ups and debits everything else', () => {
    expect(transactionDelta('topup', 1000)).toBe(1000);
    expect(transactionDelta('installment_debit', 1000)).toBe(-1000);
  });

  it('formats IDR without decimals', () => {
    expect(formatCurrency(2348333)).toContain('2,348,333');
  });
});

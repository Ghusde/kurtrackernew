import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './prisma.js';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backupDir = path.join(__dirname, '..', 'backup');
mkdirSync(backupDir, { recursive: true });

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

async function backupData() {
  const loanInfo = await prisma.loanInfo.findFirst();
  const loanPayments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } });
  const accountTransactions = await prisma.accountTransaction.findMany({ orderBy: { transactionDate: 'asc' } });

  writeFileSync(
    path.join(backupDir, 'backup.json'),
    JSON.stringify({ loanInfo, loanPayments, accountTransactions }, null, 2)
  );
}

async function ensureSeedData() {
  let loanInfo = await prisma.loanInfo.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!loanInfo) {
    loanInfo = await prisma.loanInfo.create({
      data: {
        plafond: 100000000,
        disbursedAmount: 95000000,
        monthlyInstallment: 2500000,
        tenorMonths: 48,
        startDate: new Date('2026-01-25')
      }
    });
  }

let balance = await prisma.accountBalance.findFirst({ orderBy: { updatedAt: 'asc' } });
  if (!balance) {
    balance = await prisma.accountBalance.create({
      data: {
        currentBalance: loanInfo.disbursedAmount,
        updatedAt: new Date()
      }
    });

    await backupData();
  }

  return loanInfo;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/setup', async (req, res) => {
  const payload = req.body;
  const created = await prisma.loanInfo.create({
    data: {
      plafond: Number(payload.plafon ?? 100000000),
      disbursedAmount: Number(payload.disbursedAmount ?? 95000000),
      monthlyInstallment: Number(payload.monthlyInstallment ?? 2500000),
      tenorMonths: Number(payload.tenorMonths ?? 48),
      startDate: new Date(payload.startDate ?? '2026-01-25')
    }
  });

  await prisma.accountBalance.create({
    data: {
      currentBalance: created.disbursedAmount,
      updatedAt: new Date()
    }
  });

  await backupData();
  res.json({ ok: true, loanInfo: created });
});

app.post('/api/set-balance', async (req, res) => {
  await ensureSeedData();
  const { balance } = req.body;
  if (typeof balance !== 'number' || balance < 0) {
    return res.status(400).json({ error: 'Invalid balance value.' });
  }

  const updated = await prisma.accountBalance.updateMany({
    data: { currentBalance: balance, updatedAt: new Date() }
  });

  await backupData();
  res.json({ ok: updated.count > 0 });
});

app.get('/api/dashboard', async (_req, res) => {
  await ensureSeedData();
  const loanInfo = await prisma.loanInfo.findFirst();
  const payments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'desc' }, take: 5 });
  const transactions = await prisma.accountTransaction.findMany({ orderBy: { transactionDate: 'desc' }, take: 5 });
  const balance = await prisma.accountBalance.findFirst();

  if (!loanInfo || !balance) {
    return res.json({ loanInfo: null, balance: null, payments: [], transactions: [] });
  }

  const paidAggregate = await prisma.loanPayment.aggregate({
    where: { loanInfoId: loanInfo.id },
    _sum: { amountPaid: true },
    _count: { _all: true }
  });
  const totalPaid = paidAggregate._sum.amountPaid ?? 0;
  const remainingDebt = Math.max(0, loanInfo.plafond - totalPaid + loanInfo.debtAdjustment);
  const paidPercent = ((loanInfo.plafond - remainingDebt) / loanInfo.plafond) * 100;
  const monthProgress = paidAggregate._count._all;

  res.json({
    loanInfo,
    balance,
    remainingDebt,
    paidPercent,
    monthProgress,
    tenorMonths: loanInfo.tenorMonths,
    payments,
    transactions,
    currency: formatCurrency
  });
});

app.get('/api/transactions', async (_req, res) => {
  await ensureSeedData();
  const transactions = await prisma.accountTransaction.findMany({ orderBy: { transactionDate: 'desc' } });
  res.json(transactions);
});

app.get('/api/loan-payments', async (_req, res) => {
  await ensureSeedData();
  const payments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } });
  res.json(payments);
});

app.post('/api/topup', async (req, res) => {
  const { amount, note } = req.body;
  await ensureSeedData();
  const loanInfo = await prisma.loanInfo.findFirst();
  const balance = await prisma.accountBalance.findFirst();
  if (!loanInfo || !balance) {
    return res.status(400).json({ error: 'Loan setup missing.' });
  }

  const topUpAmount = Number(amount);
  if (!Number.isFinite(topUpAmount) || topUpAmount <= 0) {
    return res.status(400).json({ error: 'Invalid top up amount.' });
  }

  const currentBalance = balance.currentBalance + topUpAmount;
  const transaction = await prisma.accountTransaction.create({
    data: {
      transactionDate: new Date(),
      type: 'topup',
      amount: topUpAmount,
      resultingBalance: currentBalance,
      relatedLoanPaymentId: null,
      note
    }
  });

  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  await backupData();
  res.json({ ok: true, transactions: [transaction] });
});

app.post('/api/pay-installment', async (_req, res) => {
  await ensureSeedData();

  const loanInfo = await prisma.loanInfo.findFirst();
  const balance = await prisma.accountBalance.findFirst();
  if (!loanInfo || !balance) {
    return res.status(400).json({ error: 'Loan setup missing.' });
  }

  const paidNow = new Date();
  const amount = loanInfo.monthlyInstallment;

  if (balance.currentBalance < amount) {
    return res.status(400).json({
      error: `Insufficient account balance. Need ${formatCurrency(amount)}, current balance ${formatCurrency(balance.currentBalance)}.`
    });
  }

  const currentBalance = balance.currentBalance - amount;

  const lastPayment = await prisma.loanPayment.findFirst({
    where: { loanInfoId: loanInfo.id },
    orderBy: { monthNumber: 'desc' }
  });
  const monthNumber = (lastPayment?.monthNumber ?? 0) + 1;

  if (monthNumber > loanInfo.tenorMonths) {
    return res.status(400).json({ error: 'All installments have been paid.' });
  }

  const created = await prisma.loanPayment.create({
    data: {
      loanInfoId: loanInfo.id,
      monthNumber,
      dueDate: paidNow,
      amountDue: amount,
      amountPaid: amount,
      status: 'paid',
      shortfallAmount: 0,
      generatedAt: paidNow
    }
  });

  await prisma.accountTransaction.create({
    data: {
      transactionDate: paidNow,
      type: 'installment_debit',
      amount,
      resultingBalance: currentBalance,
      relatedLoanPaymentId: created.id,
      note: `Installment month ${monthNumber}`
    }
  });

  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  await backupData();

  res.json({ ok: true, message: `Installment month ${monthNumber} paid ${formatCurrency(amount)}.` });
});

app.post('/api/set-remaining-debt', async (req, res) => {
  await ensureSeedData();
  const { remainingDebt } = req.body;
  if (typeof remainingDebt !== 'number' || !Number.isFinite(remainingDebt) || remainingDebt < 0) {
    return res.status(400).json({ error: 'Invalid remaining debt amount.' });
  }

  const loanInfo = await prisma.loanInfo.findFirst();
  if (!loanInfo) return res.status(400).json({ error: 'Loan setup missing.' });

  if (remainingDebt > loanInfo.plafond) {
    return res.status(400).json({ error: `Remaining debt cannot exceed the plafond ${formatCurrency(loanInfo.plafond)}.` });
  }

  const paidAggregate = await prisma.loanPayment.aggregate({
    where: { loanInfoId: loanInfo.id },
    _sum: { amountPaid: true }
  });
  const totalPaid = paidAggregate._sum.amountPaid ?? 0;

  await prisma.loanInfo.update({
    where: { id: loanInfo.id },
    data: { debtAdjustment: remainingDebt - (loanInfo.plafond - totalPaid) }
  });

  await backupData();
  res.json({ ok: true, message: `Remaining debt updated to ${formatCurrency(remainingDebt)}.` });
});

async function adjustBalance(delta: number) {
  const balance = await prisma.accountBalance.findFirst();
  if (!balance) throw new Error('Account balance missing.');
  const currentBalance = balance.currentBalance + delta;
  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  return currentBalance;
}

const transactionDelta = (type: string, amount: number) =>
  type === 'topup' ? amount : -amount;

app.delete('/api/transactions/:id', async (req, res) => {
  await ensureSeedData();
  const transaction = await prisma.accountTransaction.findUnique({ where: { id: req.params.id } });
  if (!transaction) return res.status(404).json({ error: 'Transaction not found.' });

  await adjustBalance(-transactionDelta(transaction.type, transaction.amount));
  await prisma.accountTransaction.delete({ where: { id: transaction.id } });
  await backupData();
  res.json({ ok: true, message: 'Transaction deleted.' });
});

app.patch('/api/transactions/:id', async (req, res) => {
  await ensureSeedData();
  const transaction = await prisma.accountTransaction.findUnique({ where: { id: req.params.id } });
  if (!transaction) return res.status(404).json({ error: 'Transaction not found.' });

  const { amount, note, transactionDate } = req.body;
  if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) {
    return res.status(400).json({ error: 'Invalid transaction amount.' });
  }

  let resultingBalance = transaction.resultingBalance;
  if (amount !== undefined && amount !== transaction.amount) {
    resultingBalance = await adjustBalance(
      transactionDelta(transaction.type, amount) - transactionDelta(transaction.type, transaction.amount)
    );
  }

  const updated = await prisma.accountTransaction.update({
    where: { id: transaction.id },
    data: {
      amount: amount ?? transaction.amount,
      note: note === undefined ? transaction.note : note,
      transactionDate: transactionDate ? new Date(transactionDate) : transaction.transactionDate,
      resultingBalance
    }
  });

  await backupData();
  res.json({ ok: true, message: 'Transaction updated.', transaction: updated });
});

app.delete('/api/loan-payments/:id', async (req, res) => {
  await ensureSeedData();
  const payment = await prisma.loanPayment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Installment not found.' });

  const relatedTransactions = await prisma.accountTransaction.findMany({
    where: { relatedLoanPaymentId: payment.id }
  });
  for (const transaction of relatedTransactions) {
    await adjustBalance(-transactionDelta(transaction.type, transaction.amount));
  }

  await prisma.accountTransaction.deleteMany({ where: { relatedLoanPaymentId: payment.id } });
  await prisma.loanPayment.delete({ where: { id: payment.id } });
  await backupData();
  res.json({ ok: true, message: 'Installment deleted.' });
});

app.patch('/api/loan-payments/:id', async (req, res) => {
  await ensureSeedData();
  const payment = await prisma.loanPayment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Installment not found.' });

  const { amountDue, amountPaid, dueDate, monthNumber } = req.body;
  for (const value of [amountDue, amountPaid]) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      return res.status(400).json({ error: 'Invalid installment amount.' });
    }
  }
  if (monthNumber !== undefined && (!Number.isInteger(monthNumber) || monthNumber < 1)) {
    return res.status(400).json({ error: 'Invalid month number.' });
  }

  const updated = await prisma.loanPayment.update({
    where: { id: payment.id },
    data: {
      monthNumber: monthNumber ?? payment.monthNumber,
      amountDue: amountDue ?? payment.amountDue,
      amountPaid: amountPaid ?? payment.amountPaid,
      shortfallAmount: 0,
      status: 'paid',
      dueDate: dueDate ? new Date(dueDate) : payment.dueDate
    }
  });

  await backupData();
  res.json({ ok: true, message: 'Installment updated.', payment: updated });
});


app.post('/api/ai/tools', async (req, res) => {
  await ensureSeedData();
  const { query, tool, params } = req.body;
  const loanInfo = await prisma.loanInfo.findFirst();
  const balance = await prisma.accountBalance.findFirst();
  const payments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } });
  const transactions = await prisma.accountTransaction.findMany({ orderBy: { transactionDate: 'desc' } });
  if (!loanInfo || !balance) {
    return res.json({ answer: 'Setup data is incomplete.' });
  }

  const totalPaid = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const remainingDebt = loanInfo.plafond - totalPaid;

  const toolName = tool ?? 'get_loan_summary';
  const toolParams = params ?? {};

  if (toolName === 'get_payment_by_month') {
    const month = Number(toolParams.month ?? 1);
    const year = Number(toolParams.year ?? new Date().getFullYear());
    const match = payments.find((payment) => payment.dueDate.getFullYear() === year && payment.dueDate.getMonth() + 1 === month);
    return res.json({ answer: `Payment status for ${month}/${year}: ${match?.status ?? 'no data'}`, data: match });
  }

  if (toolName === 'get_payment_history') {
    const limit = Number(toolParams.limit ?? 10);
    const filtered = payments.slice(0, limit);
    return res.json({ answer: `Installment history (${filtered.length} items)`, data: filtered });
  }

  if (toolName === 'get_transaction_history') {
    const limit = Number(toolParams.limit ?? 10);
    const filtered = transactions.slice(0, limit);
    return res.json({ answer: `Transaction history (${filtered.length} items)`, data: filtered });
  }

  res.json({
    answer: `AI tool response for query: ${query}\nRemaining debt: ${formatCurrency(remainingDebt)}\nAccount balance: ${formatCurrency(balance.currentBalance)}`,
    data: { remainingDebt, balance: balance.currentBalance, payments, transactions }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
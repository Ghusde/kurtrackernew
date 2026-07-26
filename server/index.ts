import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './prisma.js';
import { runCatchUp } from './catchUp.js';
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
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
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
  const loanInfo = await prisma.loanInfo.findFirst();
  if (loanInfo) return loanInfo;

  const created = await prisma.loanInfo.create({
    data: {
      plafond: 100000000,
      disbursedAmount: 95000000,
      monthlyInstallment: 2500000,
      tenorMonths: 48,
      startDate: new Date('2026-01-25')
    }
  });

  await prisma.accountBalance.create({
    data: {
      currentBalance: created.disbursedAmount,
      updatedAt: new Date()
    }
  });

  await prisma.accountTransaction.create({
    data: {
      transactionDate: new Date(created.startDate),
      type: 'topup',
      amount: created.disbursedAmount,
      resultingBalance: created.disbursedAmount,
      relatedLoanPaymentId: null,
      note: 'Pencairan awal KUR',
      isUndone: false
    }
  });

  await backupData();
  return created;
}

app.use(async (_req, _res, next) => {
  if (_req.path.startsWith('/api/dashboard') || _req.path.startsWith('/api/transactions') || _req.path.startsWith('/api/loan-payments') || _req.path.startsWith('/api/ai')) {
    await runCatchUp();
  }
  next();
});

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

  await prisma.accountTransaction.create({
    data: {
      transactionDate: new Date(created.startDate),
      type: 'topup',
      amount: created.disbursedAmount,
      resultingBalance: created.disbursedAmount,
      relatedLoanPaymentId: null,
      note: 'Pencairan awal KUR',
      isUndone: false
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
  const transactions = await prisma.accountTransaction.findMany({ where: { isUndone: false }, orderBy: { transactionDate: 'desc' }, take: 5 });
  const balance = await prisma.accountBalance.findFirst();

  if (!loanInfo || !balance) {
    return res.json({ loanInfo: null, balance: null, payments: [], transactions: [] });
  }

  const totalPaid = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const remainingDebt = loanInfo.plafond - totalPaid;
  const paidPercent = (totalPaid / loanInfo.plafond) * 100;
  const activeShortfall = await prisma.loanPayment.findFirst({ where: { shortfallAmount: { gt: 0 } } });
  const currentMonth = new Date().getMonth() + 1;
  const startMonth = new Date(loanInfo.startDate).getMonth() + 1;
  const monthProgress = Math.max(1, currentMonth - startMonth + 1);

  res.json({
    loanInfo,
    balance,
    remainingDebt,
    paidPercent,
    monthProgress,
    tenorMonths: loanInfo.tenorMonths,
    activeShortfall: Boolean(activeShortfall),
    payments,
    transactions,
    currency: formatCurrency
  });
});

app.get('/api/transactions', async (_req, res) => {
  await ensureSeedData();
  const transactions = await prisma.accountTransaction.findMany({ where: { isUndone: false }, orderBy: { transactionDate: 'desc' } });
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

  const pendingShortfalls = await prisma.loanPayment.findMany({
    where: { shortfallAmount: { gt: 0 } },
    orderBy: { dueDate: 'asc' }
  });

  let remaining = Number(amount);
  let currentBalance = balance.currentBalance;
  const createdTransactions = [] as any[];

  for (const payment of pendingShortfalls) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, payment.shortfallAmount);
    if (applied <= 0) continue;

    const newShortfall = payment.shortfallAmount - applied;
    const status = newShortfall > 0 ? 'menunggu_pelunasan' : 'lunas';
    await prisma.loanPayment.update({
      where: { id: payment.id },
      data: { shortfallAmount: newShortfall, status }
    });

    currentBalance += 0;
    const tx = await prisma.accountTransaction.create({
      data: {
        transactionDate: new Date(),
        type: 'shortfall_recovery',
        amount: applied,
        resultingBalance: currentBalance,
        relatedLoanPaymentId: payment.id,
        note: 'Shortfall recovery',
        isUndone: false
      }
    });
    createdTransactions.push(tx);
    remaining -= applied;
  }

  if (remaining > 0) {
    currentBalance += remaining;
    const tx = await prisma.accountTransaction.create({
      data: {
        transactionDate: new Date(),
        type: 'topup',
        amount: remaining,
        resultingBalance: currentBalance,
        relatedLoanPaymentId: null,
        note,
        isUndone: false
      }
    });
    createdTransactions.push(tx);
  }

  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  await backupData();
  res.json({ ok: true, transactions: createdTransactions });
});

app.post('/api/pay-installment', async (_req, res) => {
  await ensureSeedData();
  await runCatchUp();

  const balance = await prisma.accountBalance.findFirst();
  if (!balance) {
    return res.status(400).json({ error: 'Loan setup missing.' });
  }

  const payment = await prisma.loanPayment.findFirst({
    where: { shortfallAmount: { gt: 0 } },
    orderBy: { dueDate: 'asc' }
  });

  if (!payment) {
    return res.json({ ok: true, message: 'Tidak ada cicilan tertunggak.' });
  }

  if (balance.currentBalance <= 0) {
    return res.status(400).json({ error: 'Saldo rekening kosong, top up dulu.' });
  }

  const paid = Math.min(balance.currentBalance, payment.shortfallAmount);
  const shortfallAmount = payment.shortfallAmount - paid;
  const currentBalance = balance.currentBalance - paid;

  await prisma.loanPayment.update({
    where: { id: payment.id },
    data: {
      amountPaid: payment.amountPaid + paid,
      shortfallAmount,
      status: shortfallAmount > 0 ? 'gagal_debit' : 'lunas'
    }
  });

  await prisma.accountTransaction.create({
    data: {
      transactionDate: new Date(),
      type: 'debit_cicilan',
      amount: paid,
      resultingBalance: currentBalance,
      relatedLoanPaymentId: payment.id,
      note: `Cicilan bulan ${payment.monthNumber}`,
      isUndone: false
    }
  });

  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  await backupData();

  res.json({
    ok: true,
    message: shortfallAmount > 0
      ? `Cicilan bulan ${payment.monthNumber} dibayar sebagian ${formatCurrency(paid)}, sisa kurang ${formatCurrency(shortfallAmount)}.`
      : `Cicilan bulan ${payment.monthNumber} lunas (${formatCurrency(paid)}).`
  });
});

app.post('/api/undo', async (_req, res) => {
  await ensureSeedData();
  const lastTransaction = await prisma.accountTransaction.findFirst({ where: { isUndone: false }, orderBy: { createdAt: 'desc' } });
  if (!lastTransaction) return res.status(404).json({ error: 'No transaction to undo.' });
  await prisma.accountTransaction.update({ where: { id: lastTransaction.id }, data: { isUndone: true } });
  await backupData();
  res.json({ ok: true });
});

app.post('/api/ai/tools', async (req, res) => {
  await ensureSeedData();
  const { query, tool, params } = req.body;
  const loanInfo = await prisma.loanInfo.findFirst();
  const balance = await prisma.accountBalance.findFirst();
  const payments = await prisma.loanPayment.findMany({ orderBy: { dueDate: 'asc' } });
  const transactions = await prisma.accountTransaction.findMany({ where: { isUndone: false }, orderBy: { transactionDate: 'desc' } });
  if (!loanInfo || !balance) {
    return res.json({ answer: 'Setup data belum lengkap.' });
  }

  const totalPaid = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const remainingDebt = loanInfo.plafond - totalPaid;
  const activeShortfall = payments.some((payment) => payment.shortfallAmount > 0);

  const toolName = tool ?? 'get_loan_summary';
  const toolParams = params ?? {};

  if (toolName === 'get_payment_by_month') {
    const month = Number(toolParams.month ?? 1);
    const year = Number(toolParams.year ?? new Date().getFullYear());
    const match = payments.find((payment) => payment.dueDate.getFullYear() === year && payment.dueDate.getMonth() + 1 === month);
    return res.json({ answer: `Status pembayaran bulan ${month}/${year}: ${match?.status ?? 'tidak ada data'}`, data: match });
  }

  if (toolName === 'get_payment_history') {
    const limit = Number(toolParams.limit ?? 10);
    const filtered = payments.slice(0, limit);
    return res.json({ answer: `Riwayat cicilan (${filtered.length} item)`, data: filtered });
  }

  if (toolName === 'get_transaction_history') {
    const limit = Number(toolParams.limit ?? 10);
    const filtered = transactions.slice(0, limit);
    return res.json({ answer: `Riwayat transaksi (${filtered.length} item)`, data: filtered });
  }

  res.json({
    answer: `AI tool response untuk query: ${query}\nSisa utang: ${formatCurrency(remainingDebt)}\nSaldo rekening: ${formatCurrency(balance.currentBalance)}\nAda shortfall aktif: ${activeShortfall ? 'ya' : 'tidak'}.`,
    data: { remainingDebt, balance: balance.currentBalance, activeShortfall, payments, transactions }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

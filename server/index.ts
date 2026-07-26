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

  const paidAggregate = await prisma.loanPayment.aggregate({
    where: { loanInfoId: loanInfo.id },
    _sum: { amountPaid: true },
    _count: { _all: true }
  });
  const totalPaid = paidAggregate._sum.amountPaid ?? 0;
  const remainingDebt = Math.max(0, loanInfo.plafond - totalPaid + loanInfo.debtAdjustment);
  const paidPercent = ((loanInfo.plafond - remainingDebt) / loanInfo.plafond) * 100;
  const activeShortfall = await prisma.loanPayment.findFirst({ where: { shortfallAmount: { gt: 0 } } });
  const monthProgress = paidAggregate._count._all;

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

  const loanInfo = await prisma.loanInfo.findFirst();
  const balance = await prisma.accountBalance.findFirst();
  if (!loanInfo || !balance) {
    return res.status(400).json({ error: 'Loan setup missing.' });
  }

  const outstanding = await prisma.loanPayment.findFirst({
    where: { loanInfoId: loanInfo.id, shortfallAmount: { gt: 0 } },
    orderBy: { dueDate: 'asc' }
  });

  const paidNow = new Date();
  const amount = outstanding
    ? Math.min(outstanding.shortfallAmount, loanInfo.monthlyInstallment)
    : loanInfo.monthlyInstallment;

  if (balance.currentBalance < amount) {
    return res.status(400).json({
      error: `Saldo rekening kurang. Butuh ${formatCurrency(amount)}, saldo sekarang ${formatCurrency(balance.currentBalance)}.`
    });
  }

  const currentBalance = balance.currentBalance - amount;
  let paymentId: string;
  let monthNumber: number;

  if (outstanding) {
    const shortfallAmount = outstanding.shortfallAmount - amount;
    await prisma.loanPayment.update({
      where: { id: outstanding.id },
      data: {
        amountPaid: outstanding.amountPaid + amount,
        shortfallAmount,
        status: shortfallAmount > 0 ? 'gagal_debit' : 'lunas'
      }
    });
    paymentId = outstanding.id;
    monthNumber = outstanding.monthNumber;
  } else {
    const lastPayment = await prisma.loanPayment.findFirst({
      where: { loanInfoId: loanInfo.id },
      orderBy: { monthNumber: 'desc' }
    });
    monthNumber = (lastPayment?.monthNumber ?? 0) + 1;

    if (monthNumber > loanInfo.tenorMonths) {
      return res.status(400).json({ error: 'Semua cicilan sudah lunas.' });
    }

    const created = await prisma.loanPayment.create({
      data: {
        loanInfoId: loanInfo.id,
        monthNumber,
        dueDate: paidNow,
        amountDue: loanInfo.monthlyInstallment,
        amountPaid: amount,
        status: 'lunas',
        shortfallAmount: 0,
        generatedAt: paidNow
      }
    });
    paymentId = created.id;
  }

  await prisma.accountTransaction.create({
    data: {
      transactionDate: paidNow,
      type: 'debit_cicilan',
      amount,
      resultingBalance: currentBalance,
      relatedLoanPaymentId: paymentId,
      note: `Cicilan bulan ${monthNumber}`,
      isUndone: false
    }
  });

  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  await backupData();

  res.json({ ok: true, message: `Cicilan bulan ${monthNumber} dibayar ${formatCurrency(amount)}.` });
});

app.post('/api/set-remaining-debt', async (req, res) => {
  await ensureSeedData();
  const { remainingDebt } = req.body;
  if (typeof remainingDebt !== 'number' || !Number.isFinite(remainingDebt) || remainingDebt < 0) {
    return res.status(400).json({ error: 'Nominal sisa pinjaman tidak valid.' });
  }

  const loanInfo = await prisma.loanInfo.findFirst();
  if (!loanInfo) return res.status(400).json({ error: 'Loan setup missing.' });

  if (remainingDebt > loanInfo.plafond) {
    return res.status(400).json({ error: `Sisa pinjaman tidak boleh melebihi plafond ${formatCurrency(loanInfo.plafond)}.` });
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
  res.json({ ok: true, message: `Sisa pinjaman diubah jadi ${formatCurrency(remainingDebt)}.` });
});

async function applyTransactionEffect(transaction: { type: string; amount: number; relatedLoanPaymentId: string | null }, direction: 'apply' | 'revert') {
  const balance = await prisma.accountBalance.findFirst();
  if (!balance) throw new Error('Account balance missing.');

  const incoming = transaction.type === 'topup' || transaction.type === 'shortfall_recovery';
  const signedAmount = (incoming ? transaction.amount : -transaction.amount) * (direction === 'apply' ? 1 : -1);
  const currentBalance = balance.currentBalance + signedAmount;
  if (currentBalance < 0) return null;

  if (transaction.type === 'debit_cicilan' && transaction.relatedLoanPaymentId) {
    const payment = await prisma.loanPayment.findUnique({ where: { id: transaction.relatedLoanPaymentId } });
    if (payment) {
      const amountPaid = direction === 'apply' ? payment.amountPaid + transaction.amount : payment.amountPaid - transaction.amount;
      const shortfallAmount = Math.max(0, payment.amountDue - amountPaid);
      await prisma.loanPayment.update({
        where: { id: payment.id },
        data: { amountPaid, shortfallAmount, status: shortfallAmount > 0 ? 'gagal_debit' : 'lunas' }
      });
    }
  }

  await prisma.accountBalance.updateMany({ data: { currentBalance, updatedAt: new Date() } });
  return currentBalance;
}

app.post('/api/undo', async (_req, res) => {
  await ensureSeedData();
  const lastTransaction = await prisma.accountTransaction.findFirst({ where: { isUndone: false }, orderBy: { createdAt: 'desc' } });
  if (!lastTransaction) return res.status(404).json({ error: 'Tidak ada transaksi untuk di-undo.' });

  const currentBalance = await applyTransactionEffect(lastTransaction, 'revert');
  if (currentBalance === null) {
    return res.status(400).json({ error: 'Saldo tidak cukup untuk membatalkan transaksi ini.' });
  }

  await prisma.accountTransaction.update({ where: { id: lastTransaction.id }, data: { isUndone: true } });
  await backupData();
  res.json({ ok: true, message: 'Transaksi terakhir dibatalkan.' });
});

app.post('/api/redo', async (_req, res) => {
  await ensureSeedData();
  const lastUndone = await prisma.accountTransaction.findFirst({ where: { isUndone: true }, orderBy: { createdAt: 'desc' } });
  if (!lastUndone) return res.status(404).json({ error: 'Tidak ada transaksi untuk di-redo.' });

  const currentBalance = await applyTransactionEffect(lastUndone, 'apply');
  if (currentBalance === null) {
    return res.status(400).json({ error: 'Saldo tidak cukup untuk mengulang transaksi ini.' });
  }

  await prisma.accountTransaction.update({
    where: { id: lastUndone.id },
    data: { isUndone: false, resultingBalance: currentBalance }
  });
  await backupData();
  res.json({ ok: true, message: 'Transaksi terakhir dikembalikan.' });
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

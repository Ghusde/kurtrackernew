-- KUR Tracker schema for Supabase Postgres.
--
-- Preferred path is `npx prisma migrate deploy` (uses prisma/migrations).
-- This file is the manual fallback: paste it into the Supabase SQL Editor.
-- It matches prisma/schema.prisma exactly.

CREATE TABLE IF NOT EXISTS "LoanInfo" (
    "id" TEXT NOT NULL,
    "plafond" DOUBLE PRECISION NOT NULL,
    "disbursedAmount" DOUBLE PRECISION NOT NULL,
    "monthlyInstallment" DOUBLE PRECISION NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "debtAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanInfo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LoanPayment" (
    "id" TEXT NOT NULL,
    "loanInfoId" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountDue" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "shortfallAmount" DOUBLE PRECISION NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccountBalance" (
    "id" TEXT NOT NULL,
    "currentBalance" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccountTransaction" (
    "id" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "resultingBalance" DOUBLE PRECISION NOT NULL,
    "relatedLoanPaymentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LoanPayment"
  DROP CONSTRAINT IF EXISTS "LoanPayment_loanInfoId_fkey";
ALTER TABLE "LoanPayment"
  ADD CONSTRAINT "LoanPayment_loanInfoId_fkey"
  FOREIGN KEY ("loanInfoId") REFERENCES "LoanInfo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountTransaction"
  DROP CONSTRAINT IF EXISTS "AccountTransaction_relatedLoanPaymentId_fkey";
ALTER TABLE "AccountTransaction"
  ADD CONSTRAINT "AccountTransaction_relatedLoanPaymentId_fkey"
  FOREIGN KEY ("relatedLoanPaymentId") REFERENCES "LoanPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- These tables are reached only through the Vercel serverless functions using
-- the Postgres service credentials, never from the browser, so no anon-key
-- access and no RLS policies are involved. Row Level Security stays off.

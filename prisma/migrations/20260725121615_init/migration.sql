-- CreateTable
CREATE TABLE "LoanInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plafond" REAL NOT NULL,
    "disbursedAmount" REAL NOT NULL,
    "monthlyInstallment" REAL NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanInfoId" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "amountDue" REAL NOT NULL,
    "amountPaid" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "shortfallAmount" REAL NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanPayment_loanInfoId_fkey" FOREIGN KEY ("loanInfoId") REFERENCES "LoanInfo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currentBalance" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AccountTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionDate" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "resultingBalance" REAL NOT NULL,
    "relatedLoanPaymentId" TEXT,
    "note" TEXT,
    "isUndone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountTransaction_relatedLoanPaymentId_fkey" FOREIGN KEY ("relatedLoanPaymentId") REFERENCES "LoanPayment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

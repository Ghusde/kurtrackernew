-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LoanInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plafond" REAL NOT NULL,
    "disbursedAmount" REAL NOT NULL,
    "monthlyInstallment" REAL NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "debtAdjustment" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_LoanInfo" ("createdAt", "disbursedAmount", "id", "monthlyInstallment", "plafond", "startDate", "tenorMonths") SELECT "createdAt", "disbursedAmount", "id", "monthlyInstallment", "plafond", "startDate", "tenorMonths" FROM "LoanInfo";
DROP TABLE "LoanInfo";
ALTER TABLE "new_LoanInfo" RENAME TO "LoanInfo";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

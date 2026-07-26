-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AccountTransaction" RENAME COLUMN "isUndone" TO "isDeleted";

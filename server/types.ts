export type LoanInfo = {
  id: string;
  plafond: number;
  disbursedAmount: number;
  monthlyInstallment: number;
  tenorMonths: number;
  startDate: string;
};

export type LoanPayment = {
  id: string;
  monthNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  status: string;
  shortfallAmount: number;
};

export type AccountTransaction = {
  id: string;
  transactionDate: string;
  type: string;
  amount: number;
  resultingBalance: number;
  relatedLoanPaymentId: string | null;
  note: string | null;
  isUndone: boolean;
};

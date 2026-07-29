import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api';

type DashboardData = {
  loanInfo: {
    plafond: number;
    monthlyInstallment: number;
    tenorMonths: number;
    startDate: string;
  } | null;
  balance: { currentBalance: number } | null;
  remainingDebt: number;
  paidPercent: number;
  monthProgress: number;
  tenorMonths: number;
  payments: Array<{ id: string; monthNumber: number; amountPaid: number; status: string; shortfallAmount: number; dueDate: string }>;
  transactions: Array<{ id: string; type: string; amount: number; resultingBalance: number; note: string | null; transactionDate: string }>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function formatThousands(rawDigits: string) {
  return rawDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function toDigits(value: string) {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function getMonthYear(dateStr: string) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' }).format(date);
}

function toDateInputValue(dateStr: string) {
  return new Date(dateStr).toISOString().split('T')[0];
}

// Keep this in sync with MAX_REMAINING_DEBT on the server (server/index.ts).
// It's only used here to show a hint and give instant client-side feedback;
// the server still enforces the real limit.
const MAX_REMAINING_DEBT = 120000000;

type LoanPayment = {
  id: string;
  monthNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  shortfallAmount: number;
  status: string;
};

type AccountTransaction = {
  id: string;
  transactionDate: string;
  type: string;
  amount: number;
  resultingBalance: number;
  note: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  debit_cicilan: 'installment debit'
};

const typeLabel = (type: string) => TYPE_LABELS[type] ?? type.replace(/_/g, ' ');

const isIncoming = (type: string) => type === 'topup';

function getRoute() {
  return window.location.hash.replace(/^#/, '') || '/';
}

function useRoute() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

export default function App() {
  const route = useRoute();

  if (route === '/loan-payments') return <LoanPaymentsPage />;
  if (route === '/transactions') return <TransactionsPage />;
  return <Dashboard />;
}

function DetailLayout({ title, subtitle, wide, children }: { title: string; subtitle: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <>
      <div className="background-surface" aria-hidden="true"></div>

      <header className="navbar">
        <div className="navbar-inner">
          <div className="brand">
            <span className="brand-mark">◈</span>
            <span className="brand-name">KUR<span className="brand-name-light">Tracker</span></span>
          </div>
          <nav className="nav-tabs">
            <a className="nav-tab" href="#/">Home</a>
          </nav>
        </div>
      </header>

      <main className={`page detail-page${wide ? ' is-wide' : ''}`}>
        <section className="detail-head">
          <h1 className="detail-title">{title}</h1>
          <p className="detail-subtitle">{subtitle}</p>
        </section>
        <section className="detail-panel">{children}</section>
      </main>
    </>
  );
}

function LoanPaymentsPage() {
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ monthNumber: '', amountDue: '', amountPaid: '', dueDate: '' });
  const [error, setError] = useState('');

  const loadPayments = async () => {
    const res = await apiFetch('/api/loan-payments');
    setPayments(await res.json());
  };

  useEffect(() => { void loadPayments(); }, []);

  const startEdit = (payment: LoanPayment) => {
    setEditingId(payment.id);
    setDraft({
      monthNumber: String(payment.monthNumber),
      amountDue: String(Math.round(payment.amountDue)),
      amountPaid: String(Math.round(payment.amountPaid)),
      dueDate: toDateInputValue(payment.dueDate)
    });
  };

  const request = async (url: string, init: RequestInit) => {
    const res = await apiFetch(url, init);
    const json = await res.json();
    if (!json.ok) setError(json.error || 'Request failed.');
    else setError('');
    await loadPayments();
  };

  const saveEdit = async (id: string) => {
    await request(`/api/loan-payments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monthNumber: Number(draft.monthNumber),
        amountDue: Number(draft.amountDue),
        amountPaid: Number(draft.amountPaid),
        dueDate: draft.dueDate
      })
    });
    setEditingId(null);
  };

  const totalPaid = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);

  return (
    <DetailLayout
      wide
      title="All Installment History"
      subtitle={`${payments.length} installments · total paid ${formatCurrency(totalPaid)}`}
    >
      {error && <p className="detail-empty">{error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Date</th>
            <th className="is-numeric">Due</th>
            <th className="is-numeric">Paid</th>
            <th className="is-numeric">Shortfall</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>
                {editingId === payment.id ? (
                  <input
                    type="number"
                    min="1"
                    value={draft.monthNumber}
                    onChange={(e) => setDraft({ ...draft, monthNumber: e.target.value })}
                  />
                ) : `Month ${payment.monthNumber}`}
              </td>
              <td>
                {editingId === payment.id ? (
                  <input
                    type="date"
                    value={draft.dueDate}
                    onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                  />
                ) : formatDate(payment.dueDate)}
              </td>
              <td className="is-numeric">
                {editingId === payment.id ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatThousands(draft.amountDue)}
                    onChange={(e) => setDraft({ ...draft, amountDue: toDigits(e.target.value) })}
                  />
                ) : formatCurrency(payment.amountDue)}
              </td>
              <td className="is-numeric amount-positive">
                {editingId === payment.id ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatThousands(draft.amountPaid)}
                    onChange={(e) => setDraft({ ...draft, amountPaid: toDigits(e.target.value) })}
                  />
                ) : formatCurrency(payment.amountPaid)}
              </td>
              <td className="is-numeric">—</td>
              <td><span className="status-pill is-ok">paid</span></td>
              <td>
                <div className="row-actions">
                  {editingId === payment.id ? (
                    <>
                      <button type="button" className="card-action" onClick={() => saveEdit(payment.id)}>Save</button>
                      <button type="button" className="card-action card-action-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="card-action card-action-ghost" onClick={() => startEdit(payment)}>Edit</button>
                      <button
                        type="button"
                        className="card-action card-action-ghost"
                        onClick={() => request(`/api/loan-payments/${payment.id}`, { method: 'DELETE' })}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {payments.length === 0 && <p className="detail-empty">No installment data yet.</p>}
    </DetailLayout>
  );
}

function TransactionsPage() {
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: '', note: '', transactionDate: '' });
  const [error, setError] = useState('');

  const loadTransactions = async () => {
    const res = await apiFetch('/api/transactions');
    setTransactions(await res.json());
  };

  useEffect(() => { void loadTransactions(); }, []);

  const request = async (url: string, init: RequestInit) => {
    const res = await apiFetch(url, init);
    const json = await res.json();
    if (!json.ok) setError(json.error || 'Request failed.');
    else setError('');
    await loadTransactions();
  };

  const startEdit = (tx: AccountTransaction) => {
    setEditingId(tx.id);
    setDraft({
      amount: String(Math.round(tx.amount)),
      note: tx.note ?? '',
      transactionDate: toDateInputValue(tx.transactionDate)
    });
  };

  const saveEdit = async (id: string) => {
    await request(`/api/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(draft.amount),
        note: draft.note,
        transactionDate: draft.transactionDate
      })
    });
    setEditingId(null);
  };

  return (
    <DetailLayout
      wide
      title="All Account Transactions"
      subtitle={`${transactions.length} transactions`}
    >
      {error && <p className="detail-empty">{error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th className="is-numeric">Amount</th>
            <th className="is-numeric">Balance After</th>
            <th>Note</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id}>
              <td>
                {editingId === tx.id ? (
                  <input
                    type="date"
                    value={draft.transactionDate}
                    onChange={(e) => setDraft({ ...draft, transactionDate: e.target.value })}
                  />
                ) : formatDate(tx.transactionDate)}
              </td>
              <td style={{ textTransform: 'capitalize' }}>{typeLabel(tx.type)}</td>
              <td className={`is-numeric ${isIncoming(tx.type) ? 'amount-positive' : 'amount-negative'}`}>
                {editingId === tx.id ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatThousands(draft.amount)}
                    onChange={(e) => setDraft({ ...draft, amount: toDigits(e.target.value) })}
                  />
                ) : (
                  <>{isIncoming(tx.type) ? '+ ' : '− '}{formatCurrency(tx.amount)}</>
                )}
              </td>
              <td className="is-numeric">{formatCurrency(tx.resultingBalance)}</td>
              <td>
                {editingId === tx.id ? (
                  <input
                    type="text"
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                ) : (tx.note || '—')}
              </td>
              <td>
                <div className="row-actions">
                  {editingId === tx.id ? (
                    <>
                      <button type="button" className="card-action" onClick={() => saveEdit(tx.id)}>Save</button>
                      <button type="button" className="card-action card-action-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="card-action card-action-ghost" onClick={() => startEdit(tx)}>Edit</button>
                      <button
                        type="button"
                        className="card-action card-action-ghost"
                        onClick={() => request(`/api/transactions/${tx.id}`, { method: 'DELETE' })}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {transactions.length === 0 && <p className="detail-empty">No transactions yet.</p>}
    </DetailLayout>
  );
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [formMode, setFormMode] = useState<'topup' | 'edit'>('topup');
  const [newBalance, setNewBalance] = useState('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
  const [editingDebt, setEditingDebt] = useState(false);
  const [debtDraft, setDebtDraft] = useState('');

  const loadData = async () => {
    const res = await apiFetch('/api/dashboard');
    const json = await res.json();
    setData(json);
  };

  useEffect(() => { void loadData(); }, []);

  const progress = useMemo(() => Math.min(100, Math.max(0, data?.paidPercent ?? 0)), [data]);

  const submitTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    const res = await apiFetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount), note })
    });
    const json = await res.json();
    setMessage(json.ok ? 'Top up saved successfully.' : json.error || 'Request failed.');
    setAmount('');
    setNote('');
    await loadData();
    setTimeout(() => setMessage(''), 3000);
  };

  const saveBalance = async () => {
    if (!newBalance) return;
    const res = await apiFetch('/api/set-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: Number(newBalance) })
    });
    const json = await res.json();
    if (json.ok) {
      setFormMode('topup');
      setNewBalance('');
      setMessage('Account balance updated.');
      await loadData();
      setTimeout(() => setMessage(''), 3000);
    } else {
      setMessage(json.error || 'Failed to update balance.');
    }
  };

  const runAction = async (url: string, fallbackMessage: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(url, { method: 'POST' });
      const json = await res.json();
      setMessage(json.ok ? json.message || fallbackMessage : json.error || 'Request failed.');
      await loadData();
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  const startEditDebt = () => {
    setDebtDraft(String(Math.round(data?.remainingDebt ?? 0)));
    setEditingDebt(true);
  };

  const saveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !debtDraft) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/set-remaining-debt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remainingDebt: Number(debtDraft) })
      });
      const json = await res.json();
      setMessage(json.ok ? json.message || 'Remaining debt updated.' : json.error || 'Failed to update remaining debt.');
      if (json.ok) setEditingDebt(false);
      await loadData();
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  const payInstallment = () => runAction('/api/pay-installment', 'Installment paid successfully.');

  return (
    <>
      <div className="background-surface" aria-hidden="true"></div>

      <header className="navbar">
        <div className="navbar-inner">
          <div className="brand">
            <span className="brand-mark">◈</span>
            <span className="brand-name">KUR<span className="brand-name-light">Tracker</span></span>
          </div>
          <nav className="nav-tabs">
            <button className="nav-tab is-active">Home</button>
          </nav>
        </div>
      </header>

      <main className="page">
        {/* Hero */}
        <section className="hero">
          <p className="hero-eyebrow">Remaining KUR Debt</p>
          <div className="hero-glow" aria-hidden="true"></div>
          {!editingDebt && (
            <button type="button" className="hero-edit-btn" onClick={startEditDebt} title="Edit remaining debt" aria-label="Edit remaining debt">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {editingDebt ? (
            <form className="hero-edit" onSubmit={saveDebt}>
              <div className="input-prefix hero-edit-input">
                <span>Rp</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  aria-label="Remaining KUR debt"
                  value={formatThousands(debtDraft)}
                  onChange={(e) => setDebtDraft(toDigits(e.target.value))}
                />
              </div>
              <p className="hero-edit-hint">Max {formatCurrency(MAX_REMAINING_DEBT)}</p>
              <button type="submit" className="card-action" disabled={busy}>Save</button>
              <button type="button" className="card-action card-action-ghost" onClick={() => setEditingDebt(false)}>Cancel</button>
            </form>
          ) : (
            <h1 className="hero-figure">
              <span className="hero-currency">Rp</span>
              <span className="hero-number">{formatThousands(String(Math.round(data?.remainingDebt ?? 0)))}</span>
            </h1>
          )}

          <div className="hero-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <div className="progress-meta">
              <span>Month {data?.monthProgress ?? 0} of {data?.tenorMonths ?? 0}</span>
              <span className="progress-dot">•</span>
              <span>{data ? `${progress.toFixed(1)}% paid` : '—'}</span>
              <span className="progress-dot">•</span>
              <span>{data ? `${Math.max(0, (data.tenorMonths - (data.monthProgress || 0)))} months left` : '—'}</span>
            </div>
          </div>

        </section>

        {/* Cards */}
        <section className="card-grid">
          {/* Installment history */}
          <article className="card">
            <div className="card-head">
              <h2>Installment History</h2>
              <span className="card-tag">{data?.monthProgress ?? 0} payments</span>
            </div>
            <ul className="ledger">
              {data?.payments.slice(0, 3).map((payment) => (
                <li key={payment.id} className="ledger-row">
                  <div className="ledger-date">
                    <span className="ledger-day">{new Date(payment.dueDate).getDate()}</span>
                    <span className="ledger-month">{new Date(payment.dueDate).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                  </div>
                  <div className="ledger-info">
                    <span className="ledger-label">{getMonthYear(payment.dueDate)}</span>
                    <span className="ledger-sub">paid</span>
                  </div>
                  <span className="ledger-amount" style={{ color: 'var(--aurora-teal)' }}>{formatCurrency(payment.amountPaid)}</span>
                </li>
              ))}
            </ul>
            <div className="card-foot">
              <a className="card-more" href="#/loan-payments">View all history →</a>
              <button type="button" className="card-action" onClick={payInstallment} disabled={busy}>Pay</button>
            </div>
          </article>

          {/* Account balance */}
          <article className="card">
            <div className="card-head">
              <h2>KUR Account Balance</h2>
              <span className="card-tag card-tag-accent">{data ? formatCurrency(data.balance?.currentBalance ?? 0) : '—'}</span>
            </div>
            <ul className="ledger">
              {data?.transactions.slice(0, 3).map((tx) => (
                <li key={tx.id} className="ledger-row">
                  <div className="ledger-date">
                    <span className="ledger-day">{new Date(tx.transactionDate).getDate()}</span>
                    <span className="ledger-month">{new Date(tx.transactionDate).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                  </div>
                  <div className="ledger-info">
                    <span className="ledger-label" style={{ textTransform: 'capitalize' }}>{typeLabel(tx.type)}</span>
                    <span className="ledger-sub">Balance becomes {formatCurrency(tx.resultingBalance)}</span>
                  </div>
                  <span className={`ledger-amount ${tx.type === 'topup' || tx.type === 'shortfall_recovery' ? 'ledger-amount-plus' : 'ledger-amount-minus'}`}>
                    {tx.type === 'topup' || tx.type === 'shortfall_recovery' ? '+ ' : '− '}{formatCurrency(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="card-foot">
              <a className="card-more" href="#/transactions">View all transactions →</a>
            </div>
          </article>
        </section>

        {/* Form */}
        <section className="form-section">
          <h2 className="form-title">Transaction Note</h2>

          <div className="form-toggle" role="tablist">
            <button
              className={`toggle-btn ${formMode === 'topup' ? 'is-active' : ''}`}
              onClick={() => setFormMode('topup')}
              role="tab"
            >
              Account Top Up
            </button>
            <button
              className={`toggle-btn ${formMode === 'edit' ? 'is-active' : ''}`}
              onClick={() => setFormMode('edit')}
              role="tab"
            >
              Edit Account Balance
            </button>
          </div>

          <form
            className="ledger-form"
            onSubmit={formMode === 'topup' ? submitTopUp : (e) => { e.preventDefault(); saveBalance(); }}
          >
            {formMode === 'topup' ? (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="transaction-date">Date</label>
                    <input
                      type="date"
                      id="transaction-date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="amount">Amount</label>
                    <div className="input-prefix">
                      <span>Rp</span>
                      <input
                        type="text"
                        id="amount"
                        placeholder="0"
                        inputMode="numeric"
                        autoComplete="off"
                        value={formatThousands(amount)}
                        onChange={(e) => setAmount(toDigits(e.target.value))}
                      />
                    </div>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="note">Note <span className="label-optional">(optional)</span></label>
                  <input
                    type="text"
                    id="note"
                    placeholder=""
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                <button type="submit" className="submit-btn">
                  <span>Submit</span>
                  <span className="submit-arrow">→</span>
                </button>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="new-balance">New Balance</label>
                  <div className="input-prefix">
                    <span>Rp</span>
                    <input
                      type="text"
                      id="new-balance"
                      placeholder="0"
                      inputMode="numeric"
                      autoComplete="off"
                      value={formatThousands(newBalance)}
                      onChange={(e) => setNewBalance(toDigits(e.target.value))}
                    />
                  </div>
                </div>

                <button type="submit" className="submit-btn" style={{ background: 'linear-gradient(135deg, #5fe3b3, #4fd9a1)' }}>
                  <span>Submit</span>
                  <span className="submit-arrow">→</span>
                </button>
              </>
            )}
          </form>

          {message && (
            <div style={{
              marginTop: '16px',
              padding: '14px',
              borderRadius: '10px',
              background: 'rgba(95, 227, 179, 0.1)',
              border: '1px solid var(--positive)',
              color: 'var(--positive)',
              fontSize: '14px',
              fontFamily: 'var(--font-body)'
            }}>
              {message}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
import { useEffect, useMemo, useState } from 'react';

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
  activeShortfall: boolean;
  payments: Array<{ id: string; monthNumber: number; amountPaid: number; status: string; shortfallAmount: number; dueDate: string }>;
  transactions: Array<{ id: string; type: string; amount: number; note: string | null; transactionDate: string }>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function formatThousands(rawDigits: string) {
  return rawDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function toDigits(value: string) {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function getMonthYear(dateStr: string) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('id-ID', { year: 'numeric', month: 'long' }).format(date);
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [formMode, setFormMode] = useState<'topup' | 'edit'>('topup');
  const [newBalance, setNewBalance] = useState('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);

  const loadData = async () => {
    const res = await fetch('/api/dashboard');
    const json = await res.json();
    setData(json);
  };

  useEffect(() => { void loadData(); }, []);

  const progress = useMemo(() => Math.min(100, Math.max(0, data?.paidPercent ?? 0)), [data]);

  const submitTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    const res = await fetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount), note })
    });
    const json = await res.json();
    setMessage(json.ok ? 'Simpan Top Up berhasil.' : json.error || 'Gagal');
    setAmount('');
    setNote('');
    await loadData();
    setTimeout(() => setMessage(''), 3000);
  };

  const saveBalance = async () => {
    if (!newBalance) return;
    const res = await fetch('/api/set-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: Number(newBalance) })
    });
    const json = await res.json();
    if (json.ok) {
      setFormMode('topup');
      setNewBalance('');
      setMessage('Saldo berhasil diperbarui.');
      await loadData();
      setTimeout(() => setMessage(''), 3000);
    } else {
      setMessage(json.error || 'Gagal mengubah saldo.');
    }
  };

  const undoLast = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/undo', { method: 'POST' });
      const json = await res.json();
      setMessage(json.ok ? 'Undo terakhir berhasil.' : json.error || 'Gagal');
      await loadData();
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  const payInstallment = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/pay-installment', { method: 'POST' });
      const json = await res.json();
      setMessage(json.ok ? json.message || 'Pembayaran cicilan berhasil.' : json.error || 'Gagal membayar cicilan.');
      await loadData();
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setBusy(false);
    }
  };

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
          <p className="hero-eyebrow">Sisa Pinjaman KUR</p>
          <div className="hero-glow" aria-hidden="true"></div>
          <h1 className="hero-figure">
            <span className="hero-currency">Rp</span>
            <span className="hero-number">{formatThousands(String(Math.round(data?.remainingDebt ?? 0)))}</span>
          </h1>

          <div className="hero-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <div className="progress-meta">
              <span>Bulan ke-{data?.monthProgress ?? 0} dari {data?.tenorMonths ?? 0}</span>
              <span className="progress-dot">•</span>
              <span>{data ? `${progress.toFixed(1)}% terbayar` : '—'}</span>
              <span className="progress-dot">•</span>
              <span>{data ? `${Math.max(0, (data.tenorMonths - (data.monthProgress || 0)))} bulan lagi` : '—'}</span>
            </div>
          </div>

          {data?.activeShortfall && (
            <div style={{ marginTop: '24px', display: 'inline-block', background: 'rgba(234, 179, 8, 0.2)', color: '#fbbf24', padding: '8px 16px', borderRadius: '9999px', fontSize: '14px' }}>
              ⚠️ Shortfall aktif
            </div>
          )}
        </section>

        {/* Cards */}
        <section className="card-grid">
          {/* Riwayat Cicilan */}
          <article className="card">
            <div className="card-head">
              <h2>Riwayat Cicilan</h2>
              <span className="card-tag">{data?.payments.length ?? 0} pembayaran</span>
            </div>
            <ul className="ledger">
              {data?.payments.slice(0, 3).map((payment) => (
                <li key={payment.id} className="ledger-row">
                  <div className="ledger-date">
                    <span className="ledger-day">{new Date(payment.dueDate).getDate()}</span>
                    <span className="ledger-month">{new Date(payment.dueDate).toLocaleDateString('id-ID', { month: 'short' }).toUpperCase()}</span>
                  </div>
                  <div className="ledger-info">
                    <span className="ledger-label">{getMonthYear(payment.dueDate)}</span>
                    <span className="ledger-sub" style={{ textTransform: 'capitalize' }}>{payment.status.replace(/_/g, ' ')}</span>
                  </div>
                  <span className="ledger-amount" style={{ color: 'var(--aurora-teal)' }}>{formatCurrency(payment.amountPaid)}</span>
                </li>
              ))}
            </ul>
            <div className="card-foot">
              <button className="card-more">Lihat semua riwayat →</button>
              <button type="button" className="card-action" onClick={payInstallment} disabled={busy}>Bayar</button>
            </div>
          </article>

          {/* Saldo Rekening */}
          <article className="card">
            <div className="card-head">
              <h2>Saldo Rekening KUR</h2>
              <span className="card-tag card-tag-accent">{data ? formatCurrency(data.balance?.currentBalance ?? 0) : '—'}</span>
            </div>
            <ul className="ledger">
              {data?.transactions.slice(0, 3).map((tx) => (
                <li key={tx.id} className="ledger-row">
                  <div className="ledger-date">
                    <span className="ledger-day">{new Date(tx.transactionDate).getDate()}</span>
                    <span className="ledger-month">{new Date(tx.transactionDate).toLocaleDateString('id-ID', { month: 'short' }).toUpperCase()}</span>
                  </div>
                  <div className="ledger-info">
                    <span className="ledger-label" style={{ textTransform: 'capitalize' }}>{tx.type.replace(/_/g, ' ')}</span>
                    <span className="ledger-sub">{tx.note ? `Saldo jadi ${formatCurrency(tx.amount)}` : (tx.type === 'topup' ? `Saldo jadi ${formatCurrency(tx.amount)}` : '—')}</span>
                  </div>
                  <span className={`ledger-amount ${tx.type === 'topup' || tx.type === 'shortfall_recovery' ? 'ledger-amount-plus' : 'ledger-amount-minus'}`}>
                    {tx.type === 'topup' || tx.type === 'shortfall_recovery' ? '+ ' : '− '}{formatCurrency(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="card-foot">
              <button className="card-more">Lihat semua transaksi →</button>
              <button type="button" className="card-action card-action-ghost" onClick={undoLast} disabled={busy}>Undo</button>
            </div>
          </article>
        </section>

        {/* Form */}
        <section className="form-section">
          <h2 className="form-title">Catatan Transaksi</h2>

          <div className="form-toggle" role="tablist">
            <button
              className={`toggle-btn ${formMode === 'topup' ? 'is-active' : ''}`}
              onClick={() => setFormMode('topup')}
              role="tab"
            >
              Top Up Rekening
            </button>
            <button
              className={`toggle-btn ${formMode === 'edit' ? 'is-active' : ''}`}
              onClick={() => setFormMode('edit')}
              role="tab"
            >
              Edit Saldo
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
                    <label htmlFor="tanggal">Tanggal</label>
                    <input
                      type="date"
                      id="tanggal"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="jumlah">Jumlah</label>
                    <div className="input-prefix">
                      <span>Rp</span>
                      <input
                        type="text"
                        id="jumlah"
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
                  <label htmlFor="catatan">Catatan <span className="label-optional">(opsional)</span></label>
                  <input
                    type="text"
                    id="catatan"
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
                  <label htmlFor="saldo-baru">Saldo Baru</label>
                  <div className="input-prefix">
                    <span>Rp</span>
                    <input
                      type="text"
                      id="saldo-baru"
                      placeholder="0"
                      inputMode="numeric"
                      autoComplete="off"
                      value={formatThousands(newBalance)}
                      onChange={(e) => setNewBalance(toDigits(e.target.value))}
                    />
                  </div>
                </div>

                <button type="submit" className="submit-btn" style={{ background: 'linear-gradient(135deg, #5fe3b3, #4fd9a1)' }}>
                  <span>Simpan Saldo</span>
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

// ─── Navbar view switching ─────────────────────────────────────
const navTabs = document.querySelectorAll('.nav-tab');
const views = {
  home: document.getElementById('view-home'),
  assistant: document.getElementById('view-assistant'),
};

navTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    navTabs.forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');

    const target = tab.dataset.view;
    Object.entries(views).forEach(([key, el]) => {
      el.hidden = key !== target;
    });
  });
});

// ─── Form mode toggle: Bayar Cicilan / Transaksi Rekening ──────
const toggleBtns = document.querySelectorAll('.toggle-btn');
const fieldJenis = document.getElementById('field-jenis');
const submitLabel = document.getElementById('submit-label');

toggleBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    toggleBtns.forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    const mode = btn.dataset.mode;
    if (mode === 'rekening') {
      fieldJenis.hidden = false;
      submitLabel.textContent = 'Simpan Transaksi';
    } else {
      fieldJenis.hidden = true;
      submitLabel.textContent = 'Simpan Pembayaran';
    }
  });
});

// ─── Segmented control: Top Up / Debet Otomatis ─────────────────
const segmentedBtns = document.querySelectorAll('.segmented-btn');
segmentedBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    segmentedBtns.forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });
});

// ─── Rupiah formatting on the amount field ──────────────────────
const jumlahInput = document.getElementById('jumlah');
jumlahInput.addEventListener('input', (e) => {
  const raw = e.target.value.replace(/\D/g, '');
  e.target.value = raw ? new Intl.NumberFormat('id-ID').format(Number(raw)) : '';
});

// ─── Prevent actual submit (this is a static mockup) ────────────
document.getElementById('ledger-form').addEventListener('submit', (e) => {
  e.preventDefault();
});

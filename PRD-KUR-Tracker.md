# PRD — KUR Loan & Account Tracker

**Versi:** 2.0
**Tanggal:** 25 Juli 2026
**Owner:** Tude Arya Asmadijaya
**Status:** Draft — siap dieksekusi ke Claude Code

---

## 0. Changelog dari v1.0

Revisi ini mengubah 3 keputusan inti dari draft sebelumnya:

| Area | v1.0 | v2.0 |
|---|---|---|
| Plafon vs dana cair | Plafon 100jt (satu angka) | Plafon kontrak **Rp100.000.000**, dana cair ke rekening **Rp95.000.000** (potongan admin/asuransi) |
| Relasi Loan ↔ Rekening | Independen, dihitung terpisah total | **Terhubung otomatis** — cicilan didebet otomatis dari saldo rekening tiap tanggal 25 |
| Input manual | 2 mode form (Bayar Cicilan + Transaksi Rekening) | **1 mode form saja: Top Up Rekening.** Cicilan ter-generate otomatis, tidak diinput manual |
| AI Assistant | Context-injection ringkasan di awal sesi | **Tool-calling** — AI query database on-demand, bisa jawab pertanyaan spesifik per-bulan |
| Storage | (belum ditentukan) | Backend + database sungguhan (bukan localStorage) |

---

## 1. Latar Belakang & Tujuan

Owner memiliki pinjaman KUR dengan plafon Rp100.000.000, tenor 4 tahun (48 bulan), cicilan bulanan fix yang didebet otomatis dari rekening khusus setiap tanggal 25. Dana yang cair ke rekening di awal hanya Rp95.000.000 (setelah potongan admin/asuransi bank).

Owner tidak mau repot mencatat pembayaran cicilan secara manual tiap bulan — satu-satunya hal yang perlu diinput manual adalah **top up saldo rekening**. Sistem yang menangani sisanya secara otomatis.

Tujuan aplikasi ini:
1. Melacak sisa utang & progress tenor tanpa hitung manual.
2. Mencatat mutasi saldo rekening khusus KUR (top up masuk, debet cicilan keluar) sebagai running balance.
3. **Otomatis mendebet cicilan dari saldo rekening tiap tanggal 25**, dan otomatis mencatatnya sebagai riwayat pembayaran cicilan — tanpa owner perlu input apa pun selain top up.
4. Menyediakan AI Assistant yang bisa **query data spesifik on-demand** (bukan cuma ringkasan), misal "cicilan Maret 2026 udah bayar belum?".

**Bukan tujuan aplikasi ini (out of scope v1):**
- Bukan aplikasi multi-user / multi-tenant.
- Tidak ada sistem login/autentikasi (akses hanya lewat private link yang tidak disebarluaskan).
- Tidak menghitung ulang skema bunga/amortisasi bank — nominal cicilan diinput manual sekali di setup, bukan dihitung dari rumus bunga.

---

## 2. User & Use Case

Single user (owner aplikasi). Use case utama:

1. **Owner top up rekening** → buka app → input nominal top up → saldo rekening bertambah. *(Ini satu-satunya input manual rutin.)*
2. **Tanggal 25 tiap bulan** → sistem otomatis mendebet nominal cicilan dari saldo rekening → mencatat entry baru di riwayat cicilan ("Cicilan bulan ke-N") → update sisa utang & progress tenor. Owner tidak melakukan apa pun.
3. **Kalau saldo tidak cukup saat tanggal 25** → sistem tetap memotong saldo sampai habis (ke 0), sisanya dicatat sebagai **kekurangan (gagal debit sebagian)**. Saat owner top up berikutnya, kekurangan itu otomatis dilunasi duluan dari top up baru, sisanya baru masuk sebagai saldo normal.
4. **Owner salah input top up** → tombol **Undo** membatalkan transaksi terakhir (saldo & riwayat kembali ke state sebelumnya).
5. **Owner ingin lihat detail lengkap** → buka halaman terpisah "Semua Riwayat Cicilan" atau "Semua Transaksi Rekening" (bukan modal, agar tidak mengganggu dashboard utama).
6. **Owner ingin tahu kondisi terkini atau data spesifik** → buka AI Assistant → tanya bebas, termasuk pertanyaan spesifik per-tanggal/bulan → AI query database on-demand dan jawab dengan angka akurat.

---

## 3. Data Model

### 3.1 `loan_info` (single row / config, diisi sekali di awal setup)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | primary key |
| `plafon` | numeric | 100.000.000 (nominal kontrak KUR) |
| `disbursed_amount` | numeric | 95.000.000 (dana yang benar-benar cair ke rekening setelah potongan) |
| `monthly_installment` | numeric | nominal cicilan tetap per bulan (input manual owner saat setup) |
| `tenor_months` | integer | 48 |
| `start_date` | date | tanggal cicilan pertama (tanggal 25 bulan pertama) |
| `created_at` | timestamp | |

### 3.2 `loan_payments` (di-generate otomatis oleh sistem, bukan input manual)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | primary key |
| `month_number` | integer | bulan ke-N (1..48), untuk memudahkan query AI per-bulan |
| `due_date` | date | tanggal seharusnya (tanggal 25 bulan terkait) |
| `amount_due` | numeric | nominal cicilan yang seharusnya (= `monthly_installment`) |
| `amount_paid` | numeric | nominal yang benar-benar terdebet (bisa < `amount_due` kalau saldo kurang) |
| `status` | enum(`lunas`, `gagal_debit`, `menunggu_pelunasan`) | `lunas` = terbayar penuh saat itu; `gagal_debit` = saldo 0 dipotong sebagian, ada kekurangan belum ditutup; `menunggu_pelunasan` = kekurangan sudah tercatat, menunggu top up berikutnya |
| `shortfall_amount` | numeric | sisa kekurangan yang belum tertutup (0 kalau lunas) |
| `generated_at` | timestamp | kapan sistem men-generate entry ini (bisa berbeda dari `due_date` kalau ada catch-up) |

### 3.3 `account_balance` (single row, current state)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | primary key |
| `current_balance` | numeric | saldo rekening khusus KUR saat ini |
| `updated_at` | timestamp | |

### 3.4 `account_transactions` (histori mutasi saldo — sumber kebenaran untuk saldo berjalan)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | primary key |
| `transaction_date` | date | tanggal transaksi |
| `type` | enum(`topup`, `debit_cicilan`, `shortfall_recovery`) | `topup` = input manual owner; `debit_cicilan` = auto-debit tanggal 25; `shortfall_recovery` = bagian dari top up yang otomatis dialokasikan menutup kekurangan bulan sebelumnya |
| `amount` | numeric | nominal transaksi (selalu positif, arah ditentukan oleh `type`) |
| `resulting_balance` | numeric | saldo setelah transaksi ini (snapshot untuk histori) |
| `related_loan_payment_id` | uuid (nullable, FK ke `loan_payments`) | menghubungkan debit/recovery ke entry cicilan terkait |
| `note` | text (nullable) | catatan opsional (khusus top up) |
| `is_undone` | boolean | ditandai `true` kalau dibatalkan lewat tombol Undo (soft delete, bukan hard delete, agar histori tetap bisa diaudit) |
| `created_at` | timestamp | |

---

## 4. Business Logic / Kalkulasi

### 4.1 Auto-debit cicilan (inti dari sistem ini)

Dijalankan lewat **cron job server-side** (karena sekarang ada backend beneran) yang jalan tiap hari jam 00:05, ditambah **catch-up check** setiap kali ada request masuk ke API (jaga-jaga kalau server down pas tanggal 25):

1. Cek apakah ada `month_number` yang jatuh tempo (`due_date` <= hari ini) tapi belum punya entry di `loan_payments`.
2. Untuk setiap bulan yang jatuh tempo (proses berurutan dari yang paling lama):
   - Ambil `current_balance` rekening.
   - **Kalau `current_balance >= monthly_installment`:** potong penuh → buat `account_transactions` (type=`debit_cicilan`, amount=`monthly_installment`) → buat `loan_payments` (status=`lunas`, amount_paid=`monthly_installment`, shortfall_amount=0).
   - **Kalau `current_balance < monthly_installment`:** potong semua saldo yang ada (bisa 0) → buat `account_transactions` (type=`debit_cicilan`, amount=`current_balance`, kalau >0) → buat `loan_payments` (status=`gagal_debit`, amount_paid=`current_balance`, shortfall_amount=`monthly_installment - current_balance`).
3. Update `account_balance.current_balance` setiap ada transaksi baru.

### 4.2 Top up & shortfall recovery

Saat owner input top up nominal `X`:
1. Cek apakah ada `loan_payments` dengan `status IN (gagal_debit, menunggu_pelunasan)` dan `shortfall_amount > 0`, urutkan dari yang paling lama.
2. Alokasikan `X` ke kekurangan tersebut dulu (bisa lebih dari satu bulan kalau `X` cukup besar) → buat `account_transactions` (type=`shortfall_recovery`) untuk tiap alokasi → update `loan_payments.shortfall_amount` dan `status` (jadi `lunas` kalau sudah tertutup penuh).
3. Sisa `X` setelah menutup semua kekurangan → masuk sebagai `account_transactions` (type=`topup`) normal, menambah `current_balance`.

### 4.3 Undo

- Undo hanya berlaku untuk transaksi `type=topup` terakhir yang **belum** sempat dipakai auto-debit/recovery (untuk menghindari state korup). Kalau top up terakhir sudah kepakai sebagian oleh shortfall recovery, sistem tampilkan warning sebelum undo, dan undo akan reverse seluruh efeknya (transaksi topup + transaksi recovery terkait ditandai `is_undone=true`, saldo & status loan_payments dikembalikan ke state sebelumnya).

### 4.4 Metrik turunan (derived, dihitung on-the-fly)

| Metrik | Formula |
|---|---|
| **Total sudah dibayar** | `SUM(loan_payments.amount_paid)` |
| **Sisa utang** | `loan_info.plafon - total_sudah_dibayar` |
| **Bulan berjalan** | Selisih kalender bulan dari `loan_info.start_date` sampai hari ini (berbasis waktu, bukan jumlah entry — tetap jalan meski ada bulan gagal debit) |
| **Sisa tenor** | `loan_info.tenor_months - bulan_berjalan` |
| **Progress %** | `(total_sudah_dibayar / loan_info.plafon) * 100` |
| **Saldo rekening saat ini** | `account_balance.current_balance` |
| **Ada kekurangan aktif?** | `EXISTS(loan_payments WHERE shortfall_amount > 0)` — ditampilkan sebagai badge peringatan di dashboard |

---

## 5. Fitur & Halaman

### 5.1 Dashboard (halaman utama)

**Card — KUR Loan**
- Sisa utang (nominal besar, fokus utama)
- Progress bar (% sudah dibayar dari plafon)
- Bulan berjalan / total tenor (misal: "Bulan ke-12 dari 48")
- Sisa tenor dalam bulan
- Badge peringatan kalau ada bulan berstatus `gagal_debit` / kekurangan aktif
- 3-4 riwayat cicilan terbaru + link "Lihat semua riwayat cicilan →"

**Card — Rekening Khusus KUR**
- Saldo saat ini (nominal besar)
- 3-4 riwayat transaksi terbaru (top up / debit cicilan / shortfall recovery) + link "Lihat semua transaksi →"

### 5.2 Form Input (satu-satunya input manual rutin)

**Top Up Saldo Rekening**
- Tanggal (default hari ini)
- Nominal
- Submit → jalankan logic 4.2 (shortfall recovery dulu, sisanya topup)
- Tombol **Undo** muncul setelah submit sukses (untuk transaksi barusan)

### 5.3 Halaman "Semua Riwayat Cicilan" (halaman terpisah, bukan modal)
- Tabel/list lengkap semua `loan_payments`, dengan status (lunas/gagal debit/menunggu pelunasan), bisa di-filter per bulan/tahun.

### 5.4 Halaman "Semua Transaksi Rekening" (halaman terpisah, bukan modal)
- Tabel/list lengkap semua `account_transactions` (kecuali yang `is_undone=true`, atau ditampilkan dicoret sebagai riwayat undo).

### 5.5 AI Assistant (tool-calling)

AI Assistant terhubung ke Claude API dengan **tool/function calling** — bukan sekadar context-injection ringkasan. Setiap pertanyaan owner bisa memicu AI memanggil tool untuk query database secara langsung, baru menjawab berdasarkan hasil query.

Contoh tools yang disediakan ke Claude API:

| Tool | Fungsi |
|---|---|
| `get_loan_summary` | Ambil sisa utang, bulan berjalan, sisa tenor, progress % |
| `get_account_summary` | Ambil saldo rekening saat ini, transaksi terakhir |
| `get_payment_by_month(month, year)` | Cek status pembayaran cicilan bulan/tahun tertentu |
| `get_payment_history(limit, status_filter)` | Ambil daftar riwayat cicilan dengan filter opsional |
| `get_transaction_history(limit, type_filter)` | Ambil daftar mutasi rekening dengan filter opsional |
| `simulate_payoff(extra_monthly_amount)` | Simulasi kapan lunas kalau ada tambahan bayar per bulan *(nice-to-have, bisa v1 atau v2)* |

Contoh pertanyaan yang harus terjawab akurat:
- "Sisa utang gw berapa?"
- "Cicilan Maret 2026 udah bayar belum?"
- "Ada bulan yang gagal debit gak?"
- "Saldo rekening gw sekarang berapa?"
- "Kapan lunas kalau gw rutin top up 3 juta/bulan?"

---

## 6. Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Express (Node.js) — termasuk cron job untuk auto-debit (section 4.1) |
| Database | Supabase (PostgreSQL) |
| AI | Claude API (Anthropic), pola **tool-calling / function calling** |
| Deployment | Vercel (frontend) + backend di Vercel Functions atau Railway/Render (perlu proses cron persisten) |

*Catatan: kalau owner mau setup lebih ringan tanpa akun Supabase, alternatifnya SQLite (file-based, jalan langsung di server Express tanpa layanan eksternal) — cocok untuk single-user, tapi kurang fleksibel kalau nanti mau akses dari banyak device sekaligus. Bisa didiskusikan sebelum eksekusi.*

Repo: **project baru, terpisah** dari portfolio.

---

## 7. Non-Functional Requirements

- **Akses:** Tidak ada sistem login. Akses dikontrol lewat kerahasiaan URL deployment (private link).
- **Privasi data:** Tidak ada data sensitif (nama, rekening, NIK) yang disimpan — hanya nominal & tanggal.
- **Platform:** Mobile-first (owner akses dari HP), tetap rapi di desktop.
- **Currency format:** Semua nominal ditampilkan dalam format Rupiah (Rp) dengan separator ribuan.
- **Reliabilitas auto-debit:** Karena backend sekarang persisten (bukan client-side saja), cron job jadi sumber utama, dengan catch-up check di setiap request sebagai fallback kalau cron sempat gagal jalan.

---

## 8. Setup Data Awal (perlu diisi owner sebelum app dipakai)

`loan_info` diisi sekali via form setup:
- `plafon`: 100.000.000
- `disbursed_amount`: 95.000.000
- `monthly_installment`: *(perlu dikonfirmasi owner — nominal cicilan tetap per bulan)*
- `tenor_months`: 48
- `start_date`: *(perlu dikonfirmasi owner — tanggal cicilan pertama, tanggal 25 bulan & tahun berapa)*

**Backfill histori:** Karena cicilan sudah berjalan ±11 bulan sebelum app ini dibuat, saat setup pertama sistem akan menjalankan logic catch-up (section 4.1) dari `start_date` sampai hari ini sekaligus, meng-generate seluruh `loan_payments` yang sudah lewat (diasumsikan status `lunas` semua, sesuai konfirmasi owner bahwa histori itu semua sudah terbayar).

`account_balance` di-seed dengan `disbursed_amount` (95jt) sebagai saldo awal — dicatat sebagai transaksi pertama (`type=topup`, note="Pencairan awal KUR") sebelum backfill cicilan dijalankan, supaya perhitungan auto-debit historis konsisten dengan saldo yang benar-benar tersedia saat itu.

---

## 9. Open Questions / Future Consideration (di luar scope v1)

- Reminder/notifikasi kalau saldo diperkirakan tidak cukup menjelang tanggal 25 (lebih mudah sekarang karena ada backend, bisa jadi v1.5/v2).
- Export data ke CSV/PDF untuk kebutuhan pembukuan.
- Grafik tren pembayaran & saldo dari waktu ke waktu.
- `simulate_payoff` tool untuk AI Assistant — masuk v1 kalau sempat, kalau tidak jadi v1.1.

---

## 10. Definition of Done (v1)

- [ ] Owner bisa top up saldo rekening, dan itu satu-satunya input manual rutin.
- [ ] Sistem otomatis mendebet cicilan tiap tanggal 25 (cron + catch-up), update sisa utang & progress secara akurat.
- [ ] Skenario saldo kurang saat tanggal 25 tertangani: potong sampai 0, tandai kekurangan, otomatis dilunasi dari top up berikutnya.
- [ ] Tombol Undo berfungsi untuk membatalkan top up terakhir dengan aman (termasuk efek shortfall recovery-nya).
- [ ] Halaman "Semua Riwayat Cicilan" dan "Semua Transaksi Rekening" tersedia sebagai halaman terpisah.
- [ ] Dashboard menampilkan ringkasan lengkap kedua modul, termasuk badge kekurangan aktif kalau ada.
- [ ] AI Assistant bisa dipanggil, menggunakan tool-calling untuk query database, dan menjawab pertanyaan spesifik per-bulan dengan akurat (bukan cuma ringkasan umum).
- [ ] Data backfill 11 bulan histori ter-generate otomatis saat setup pertama, konsisten dengan saldo awal 95jt.
- [ ] Tampilan rapi & responsif minimal di mobile.

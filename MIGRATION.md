# Migrasi: Railway/Express -> Vercel + Supabase

Panduan ini menggantikan arsitektur lama (Express jangka-panjang di Railway +
backup file lokal) dengan: **frontend Vite di Vercel + serverless functions di
Vercel + Supabase Postgres sebagai satu-satunya sumber data**.

Tidak ada data utama yang disimpan di browser. `localStorage` / `IndexedDB`
tidak dipakai sama sekali — setiap perubahan langsung ditulis ke Supabase, jadi
clear cache / clear browser data / ganti device tidak menghilangkan apa pun.

---

## 1. Arsitektur

```
Browser (React/Vite)
   |  fetch('/api/...')  <- same-origin, tanpa CORS
   v
Vercel Serverless Functions  (folder ./api, satu file = satu endpoint)
   |  Prisma Client
   v
Supabase Postgres  (transaction pooler, port 6543)
```

Frontend dan API berada di **satu project Vercel yang sama**, jadi
`VITE_API_URL` boleh kosong dan `src/api.ts` tidak perlu diubah sama sekali.

---

## 2. Struktur file baru

```
api/
  _lib/prisma.ts            PrismaClient singleton (aman untuk serverless)
  _lib/core.ts              konstanta + logika bisnis bersama (ensureSeedData, dll)
  _lib/http.ts              method dispatch, error handling, body parsing
  health.ts                 GET  /api/health
  setup.ts                  POST /api/setup
  dashboard.ts              GET  /api/dashboard
  topup.ts                  POST /api/topup
  pay-installment.ts        POST /api/pay-installment
  set-balance.ts            POST /api/set-balance
  set-remaining-debt.ts     POST /api/set-remaining-debt
  transactions/index.ts     GET  /api/transactions
  transactions/[id].ts      PATCH | DELETE /api/transactions/:id
  loan-payments/index.ts    GET  /api/loan-payments
  loan-payments/[id].ts     PATCH | DELETE /api/loan-payments/:id
  tsconfig.json             config TypeScript khusus runtime Node
scripts/backup.mjs          snapshot manual dari Supabase (dijalankan lokal)
supabase/schema.sql         SQL fallback kalau tidak mau pakai prisma migrate
tests/api.test.ts           test wiring semua route
vercel.json                 build + SPA rewrite
.env.example                template environment variables
```

Folder `_lib` diawali underscore, jadi Vercel **tidak** menganggapnya sebagai
endpoint. Totalnya 11 serverless function. Batas keras "12 function" yang dulu
berlaku di plan Hobby sudah tidak ada lagi, jadi jumlah ini tidak masalah.

Yang dihapus: `server/`, `dist-server/`, `railway.json`, `tsconfig.server.json`,
`tsconfig.node.json`, `prisma/dev.db`, dan `vite.config.js` / `vite.config.d.ts`
(artefak build lama yang justru menimpa `vite.config.ts`).

---

## 3. Environment variables

Isinya sama untuk lokal (`.env`) dan Vercel. Ambil dari
**Supabase Dashboard -> Project Settings -> Database -> Connection string**.

| Variable | Dipakai oleh | Nilai |
|---|---|---|
| `DATABASE_URL` | semua serverless function | Transaction pooler, port **6543**, wajib `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | `prisma migrate`, `prisma studio` | Session pooler, port **5432** |

```env
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
```

**Kenapa dua URL berbeda:** setiap cold start serverless membuka koneksi baru.
Tanpa transaction pooler + `connection_limit=1`, Supabase akan kehabisan
connection slot. Sebaliknya `prisma migrate` butuh session yang persistent,
yang tidak bisa lewat transaction pooler — makanya `directUrl` ke port 5432.

---

## 4. Langkah deployment

### 4.1 Buat database Supabase

1. <https://supabase.com/dashboard> -> **New project**.
2. Simpan **Database Password** yang muncul saat pembuatan — hanya tampil sekali.
3. Tunggu project selesai provisioning.

### 4.2 Ambil connection string

1. **Project Settings -> Database -> Connection string -> URI**.
2. Pilih tab **Transaction pooler** (6543) -> jadi `DATABASE_URL`
   (tambahkan `?pgbouncer=true&connection_limit=1` di ujung).
3. Pilih tab **Session pooler** (5432) -> jadi `DIRECT_URL`.
4. Ganti `[YOUR-PASSWORD]` dengan password dari langkah 4.1.
   Kalau lupa: **Database -> Reset database password**.

### 4.3 Setup Prisma + buat tabel

```bash
cp .env.example .env      # lalu isi DATABASE_URL dan DIRECT_URL
npm install               # postinstall otomatis menjalankan prisma generate
npx prisma migrate deploy # membuat semua tabel di Supabase
npx prisma migrate status # harus: "Database schema is up to date!"
```

Alternatif tanpa Prisma CLI: buka **Supabase -> SQL Editor**, paste isi
`supabase/schema.sql`, jalankan.

### 4.4 & 4.5 Deploy frontend + API (satu deploy, satu project)

Karena frontend dan API satu project, keduanya ter-deploy sekaligus.

```bash
npm i -g vercel     # kalau belum ada
vercel login
vercel link         # pilih/buat project

# environment variables (jalankan untuk tiap environment)
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
vercel env add DATABASE_URL preview
vercel env add DIRECT_URL preview
vercel env add DATABASE_URL development
vercel env add DIRECT_URL development

vercel --prod
```

Lewat dashboard: **Import Git Repository** -> Framework `Vite` terdeteksi
otomatis -> isi `DATABASE_URL` + `DIRECT_URL` di **Settings -> Environment
Variables** -> Deploy. `vercel.json` sudah mengunci build command
(`prisma generate && vite build`) dan output directory (`dist`).

Secara default function jalan di region `iad1` (US East). Supabase kamu ada di
Asia, jadi setiap query akan menyeberangi Pasifik. Setelah project dibuat,
cek region Supabase (**Project Settings -> General**) lalu samakan region
function lewat **Settings -> Functions -> Function Region**, misalnya:

| Region Supabase | Region Vercel |
|---|---|
| `ap-southeast-1` (Singapore) | `sin1` |
| `ap-northeast-1` (Tokyo) | `hnd1` |

### 4.6 Pastikan frontend terhubung ke API

Tidak ada yang perlu dikonfigurasi. `src/api.ts` memakai
`import.meta.env.VITE_API_URL || ''`, dan karena API berada di origin yang sama,
string kosong sudah benar. **Jangan** set `VITE_API_URL` di Vercel — mengisinya
dengan URL absolut justru memicu masalah CORS yang tidak perlu.

---

## 5. Cek API benar-benar jalan

```bash
# 1. function hidup + koneksi Supabase OK
curl https://<app>.vercel.app/api/health
# -> {"ok":true,"database":"connected","time":"..."}

# 2. data asli dari Postgres
curl https://<app>.vercel.app/api/dashboard
# -> {"loanInfo":{...},"balance":{...},"remainingDebt":...,"payments":[...]}

# 3. tulis, lalu buktikan persistensinya
curl -X POST https://<app>.vercel.app/api/topup \
  -H 'Content-Type: application/json' \
  -d '{"amount":100000,"note":"test"}'
curl https://<app>.vercel.app/api/transactions
```

Bukti data benar-benar di cloud: buka app di browser lain / mode incognito /
HP — saldo dan riwayat tetap sama. Atau cek langsung di
**Supabase -> Table Editor**.

Kalau ada yang gagal: **Vercel -> Deployments -> Functions -> Logs**.

| Gejala | Penyebab umum |
|---|---|
| `500` di semua endpoint | `DATABASE_URL` salah / belum di-set untuk environment itu |
| `P1001 can't reach database` | Project Supabase free tier ter-pause; buka dashboard untuk resume |
| `P1000 authentication failed` | Password salah atau sudah di-reset |
| `Too many connections` | `DATABASE_URL` masih port 5432; harus 6543 + `pgbouncer=true` |
| `Query engine not found` | `prisma generate` tidak jalan saat build; pastikan build command dari `vercel.json` terpakai |

---

## 6. Local dev vs production

| | Local | Production |
|---|---|---|
| Perintah | `npm run dev` (`vercel dev`) | `git push` -> auto deploy |
| Frontend | Vite dev server, di-proxy oleh `vercel dev` | static files dari `dist/` di CDN |
| API | function di `api/` dijalankan lokal | AWS Lambda via Vercel |
| Database | **Supabase yang sama** | Supabase |
| Env | `.env` | Vercel Environment Variables |

`vercel dev` menjalankan frontend dan API di satu port (biasanya 3000), persis
seperti production. Karena database yang dipakai sama, perubahan saat dev
menyentuh data asli — kalau ingin terpisah, buat project Supabase kedua dan
pakai `.env.development.local`.

Kalau hanya butuh UI: `npm run dev:client` (Vite saja) dengan
`VITE_API_URL=https://<app>.vercel.app` di `.env.local`.

---

## 7. Backup

Backup ke file lokal (`backup/backup.json` yang dulu ditulis setiap request)
sudah dihapus: filesystem serverless bersifat read-only dan ephemeral, jadi
tulisan itu akan selalu hilang. Penggantinya:

1. **Supabase daily backup / Point-in-Time Recovery** — otomatis, ada di
   dashboard Supabase (**Database -> Backups**). Ini pengganti utamanya.
2. **Snapshot manual** ketika mau arsip sendiri:
   ```bash
   npm run backup     # -> backup/backup-<timestamp>.json
   ```
   Dijalankan dari mesin kamu, bukan dari serverless.
3. **`pg_dump`** untuk dump SQL lengkap:
   ```bash
   pg_dump "$DIRECT_URL" -Fc -f kur-tracker.dump
   ```

File lama `backup/backup.json` sengaja tidak dihapus sebagai arsip, dan sudah
di-untrack dari git (`backup/*.json` masuk `.gitignore`) karena isinya data
keuangan asli. Tidak ada kode yang menulis ke sana lagi.

---

## 8. Perubahan perilaku (hanya dua)

Semua logika bisnis dipindahkan apa adanya — angka cicilan tetap `2.348.333`,
batas `MAX_REMAINING_DEBT` tetap `120.000.000`, rumus `debtAdjustment` dan
progress bar tidak berubah. Dua penyesuaian yang disengaja:

1. **`POST /api/setup` sekarang menolak kalau data sudah ada** (`409`), kecuali
   dikirim `{"force": true}`. Versi Express-nya membuat `LoanInfo` +
   `AccountBalance` baru setiap dipanggil, sehingga panggilan kedua akan
   meninggalkan dua baris dan `findFirst()` membaca salah satunya secara acak.
2. **Operasi multi-write dibungkus `prisma.$transaction`** (topup, pay
   installment, edit/hapus transaksi, hapus cicilan). Sebelumnya saldo dan
   ledger ditulis terpisah, jadi kegagalan di tengah bisa membuat saldo tidak
   cocok dengan riwayat.

`POST /api/ai/tools` tidak ikut dimigrasikan — tidak pernah dipanggil frontend.
Kodenya masih ada di git history kalau nanti dibutuhkan.

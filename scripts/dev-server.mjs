/**
 * Local dev server: frontend + the api/ functions on ONE port, without needing
 * a Vercel account.
 *
 *   npm run dev:local     ->  http://localhost:3000
 *
 * It mirrors what Vercel does in production: same origin for the UI and the
 * API (so no CORS), and the same file-to-route mapping that Vercel derives
 * from the api/ folder. The route table below is written out explicitly so a
 * mismatch with Vercel's own routing is obvious rather than silent.
 *
 * `npm run dev` (vercel dev) remains the highest-fidelity option; this is the
 * zero-setup one.
 */
import http from 'node:http';
import { config } from 'dotenv';
import { createServer as createViteServer } from 'vite';

// .env.local wins over .env — dotenv never overwrites an already-set variable.
config({ path: '.env.local' });
config({ path: '.env' });

const PORT = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Put it in .env.local or .env first.');
  process.exit(1);
}

// When .env.local points at the embedded Postgres (npm run db:local) and
// nothing is listening yet, start it here so this stays a single command.
// Points at a real database? Then this is a no-op.
if (/@(localhost|127\.0\.0\.1):55432\//.test(process.env.DATABASE_URL)) {
  const { startLocalDatabase } = await import('./local-db.mjs');
  await startLocalDatabase();
}

/** Exactly the routes Vercel generates from ./api. */
const ROUTES = [
  ['/api/health', 'api/health.ts'],
  ['/api/dashboard', 'api/dashboard.ts'],
  ['/api/setup', 'api/setup.ts'],
  ['/api/topup', 'api/topup.ts'],
  ['/api/pay-installment', 'api/pay-installment.ts'],
  ['/api/set-balance', 'api/set-balance.ts'],
  ['/api/set-remaining-debt', 'api/set-remaining-debt.ts'],
  ['/api/transactions', 'api/transactions/index.ts'],
  ['/api/transactions/:id', 'api/transactions/[id].ts'],
  ['/api/loan-payments', 'api/loan-payments/index.ts'],
  ['/api/loan-payments/:id', 'api/loan-payments/[id].ts']
];

function matchRoute(pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  for (const [pattern, file] of ROUTES) {
    const expected = pattern.split('/').filter(Boolean);
    if (expected.length !== parts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i].startsWith(':')) {
        params[expected[i].slice(1)] = decodeURIComponent(parts[i]);
      } else if (expected[i] !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { file, params };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

/** Minimal VercelResponse shim over the raw Node response. */
function makeRes(res) {
  const shim = {
    statusCode: 200,
    get headersSent() {
      return res.headersSent;
    },
    setHeader(key, value) {
      res.setHeader(key, value);
      return shim;
    },
    status(code) {
      shim.statusCode = code;
      return shim;
    },
    json(payload) {
      res.statusCode = shim.statusCode;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return shim;
    },
    end(...args) {
      res.statusCode = shim.statusCode;
      res.end(...args);
      return shim;
    }
  };
  return shim;
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa'
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (!url.pathname.startsWith('/api/')) {
    return vite.middlewares(req, res);
  }

  const route = matchRoute(url.pathname);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: `No API route for ${url.pathname}` }));
  }

  const started = Date.now();
  try {
    // Vite compiles the TypeScript handler on the fly, so there is no build step.
    const mod = await vite.ssrLoadModule(`/${route.file}`);
    const query = { ...Object.fromEntries(url.searchParams), ...route.params };
    const body = await readBody(req);

    await mod.default(
      { method: req.method, url: req.url, headers: req.headers, query, body },
      makeRes(res)
    );
    console.log(`  ${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
  } catch (error) {
    vite.ssrFixStacktrace(error);
    console.error(`  ${req.method} ${url.pathname} FAILED\n`, error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(error?.message ?? error) }));
    }
  }
});

server.listen(PORT, () => {
  const target = process.env.DATABASE_URL.replace(/\/\/[^@]*@/, '//***@');
  console.log('');
  console.log(`  KUR Tracker running at  http://localhost:${PORT}`);
  console.log(`  API                     http://localhost:${PORT}/api/dashboard`);
  console.log(`  Database                ${target}`);
  console.log('');
});

/**
 * Real Postgres for local development, with no Docker and no installer.
 *
 *   npm run db:local     -> starts Postgres on 127.0.0.1:55432 and stays up
 *
 * `embedded-postgres` ships actual Postgres binaries as an npm dependency, so
 * the data directory is a normal Postgres cluster that `prisma migrate` and
 * `psql` can talk to like any other server.
 *
 * `npm run dev:local` calls startLocalDatabase() automatically when
 * DATABASE_URL points at this local port, so you normally never run this file
 * by hand.
 */
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

export const DEFAULT_PORT = 55432;
export const DEFAULT_USER = 'postgres';
export const DEFAULT_PASSWORD = 'devpass';

/** Databases the two local workflows expect (see .env.local / .env.test). */
export const LOCAL_DATABASES = ['kur_app', 'kur'];

/** The cluster lives here; `.localdb/` is gitignored. */
export const DATA_DIR = '.localdb/data';

/** True if something is already listening on the port. */
export function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Start an embedded Postgres cluster (idempotent: reuses the existing data
 * directory and skips databases that already exist).
 *
 * Returns `null` when a server is already listening on the port, in which case
 * the caller does not own the lifecycle and must not stop it.
 */
export async function startLocalDatabase({
  port = Number(process.env.LOCAL_DB_PORT || DEFAULT_PORT),
  user = DEFAULT_USER,
  password = DEFAULT_PASSWORD,
  databases = LOCAL_DATABASES,
  quiet = false
} = {}) {
  if (await isPortOpen(port)) {
    if (!quiet) console.log(`  Postgres already running on port ${port}.`);
    return null;
  }

  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port,
    user,
    password,
    persistent: true,
    // Postgres logs every startup line; keep the console readable.
    onLog: () => {},
    onError: (message) => {
      const text = String(message);
      // Startup chatter we do not care about, but real errors must surface.
      if (/^LOG:|^FATAL:  database system was shut down/.test(text)) return;
      console.error(`  [postgres] ${text.trim()}`);
    }
  });

  const alreadyInitialised = existsSync(join(DATA_DIR, 'PG_VERSION'));
  if (!alreadyInitialised) {
    log('  Initialising a new Postgres data directory (.localdb/data)...');
    await pg.initialise();
  }

  log(`  Starting Postgres on 127.0.0.1:${port}...`);
  await pg.start();

  for (const name of databases) {
    try {
      await pg.createDatabase(name);
      log(`  Created database "${name}".`);
    } catch (error) {
      // 42P04 = duplicate_database, which is the expected steady state.
      if (!String(error?.message ?? error).includes('already exists')) throw error;
    }
  }

  return pg;
}

/** Block forever so the Postgres child process stays alive. */
export function keepAlive(pg) {
  const shutdown = async (signal) => {
    console.log(`\n  ${signal} received — stopping Postgres...`);
    try {
      await pg.stop();
    } catch {
      // Already gone; nothing useful to do during shutdown.
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// CLI mode: `npm run db:local`
if (process.argv[1]?.endsWith('local-db.mjs')) {
  const pg = await startLocalDatabase();

  if (!pg) {
    console.log('  Nothing to do — the port is already taken.');
    process.exit(0);
  }

  const port = Number(process.env.LOCAL_DB_PORT || DEFAULT_PORT);
  console.log('');
  console.log(`  Local Postgres ready on 127.0.0.1:${port}`);
  console.log(`  Databases: ${LOCAL_DATABASES.join(', ')}`);
  console.log(`  User:      ${DEFAULT_USER} / ${DEFAULT_PASSWORD}`);
  console.log('');
  console.log('  Apply the schema with:  npx prisma migrate deploy');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  keepAlive(pg);
}

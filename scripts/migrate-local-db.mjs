/**
 * Applies the Prisma migrations to the LOCAL development database described by
 * .env.local (the one `npm run db:local` starts).
 *
 *   npm run db:migrate
 *
 * Needed because `prisma migrate` always reads `.env` (Supabase), and there is
 * no `--env-file` flag. Mirrors scripts/migrate-test-db.mjs on purpose.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

if (!existsSync('.env.local')) {
  console.error('Missing .env.local. Copy .env.example and point it at localhost first.');
  process.exit(1);
}

config({ path: '.env.local', override: true });

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error(
    'Refusing to migrate: .env.local must point at a local database, not a remote one.\n' +
      `Got host: ${url.replace(/\/\/[^@]*@/, '//***@')}`
  );
  process.exit(1);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  shell: true
});

process.exit(result.status ?? 1);

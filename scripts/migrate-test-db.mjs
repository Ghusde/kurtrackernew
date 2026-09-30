/**
 * Applies the Prisma migrations to the LOCAL test database described by
 * .env.test. Kept as a script because `prisma migrate` has no --env-file flag,
 * and `VAR=x cmd` prefixes do not work in PowerShell.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

if (!existsSync('.env.test')) {
  console.error('Missing .env.test. Copy .env.test.example and adjust it first.');
  process.exit(1);
}

config({ path: '.env.test', override: true });

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url)) {
  console.error(
    'Refusing to migrate: .env.test must point at a local database, not a remote one.\n' +
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

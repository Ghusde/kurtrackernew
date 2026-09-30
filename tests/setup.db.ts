// Runs before the integration test file is imported, so DATABASE_URL is in
// place by the time api/_lib/prisma.ts constructs the client.
import { config } from 'dotenv';

config({ path: '.env.test', override: true });
process.env.RUN_DB_TESTS = '1';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL. Create .env.test pointing at your local Postgres.');
}

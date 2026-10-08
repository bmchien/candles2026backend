import { config as loadEnv } from 'dotenv';

/**
 * Resolves the database used by e2e tests. Tests TRUNCATE every table, so they
 * only ever run against TEST_DATABASE_URL — never against DATABASE_URL.
 */
export function resolveTestDatabaseUrl(): string {
  loadEnv({ path: '.env.test', quiet: true });
  loadEnv({ quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a disposable database (e.g. a Neon branch or a local ' +
        'PostgreSQL) in .env.test or the environment. E2E tests delete all data in it.',
    );
  }
  const appUrl = process.env.DATABASE_URL;
  if (appUrl && appUrl === url && !process.env.ALLOW_E2E_ON_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must differ from DATABASE_URL (e2e tests wipe the database).',
    );
  }
  return url;
}

import { execSync } from 'node:child_process';
import { resolveTestDatabaseUrl } from './test-database';

/** Applies all migrations to the test database once before the e2e run. */
export default function globalSetup(): void {
  const url = resolveTestDatabaseUrl();
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}

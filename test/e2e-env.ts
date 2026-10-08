import * as os from 'node:os';
import * as path from 'node:path';
import { resolveTestDatabaseUrl } from './test-database';

// Runs before each e2e test file, before the app modules are imported.
const url = resolveTestDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef';
process.env.JWT_EXPIRES_IN = '1h';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.APP_URL = 'http://localhost:3001';
process.env.THROTTLE_LIMIT = '100000';
process.env.AUTH_THROTTLE_LIMIT = '100000';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'ecommerce-e2e-uploads');

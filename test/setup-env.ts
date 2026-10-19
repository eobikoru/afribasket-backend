import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://afribasket:afribasket@localhost:5432/afribasket?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-value';
process.env.REFRESH_TOKEN_PEPPER = 'test-refresh-pepper-value';
process.env.DOCS_PASSWORD = '';
process.env.JOBS_ENABLED = 'false';
process.env.STRIPE_TAX_ENABLED = 'false';

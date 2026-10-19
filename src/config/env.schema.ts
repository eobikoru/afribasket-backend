import { z } from 'zod';

const optionalUrl = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default(''),
  BODY_LIMIT: z.string().default('1mb'),
  STOREFRONT_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_PEPPER: z.string().min(16),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DOCS_USER: z.string().default('docs'),
  DOCS_PASSWORD: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  AUTH_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RESERVATION_MINUTES: z.coerce.number().int().positive().default(15),
  CLOUDINARY_CLOUD_NAME: optionalUrl,
  CLOUDINARY_API_KEY: optionalUrl,
  CLOUDINARY_API_SECRET: optionalUrl,
  RESEND_API_KEY: optionalUrl,
  EMAIL_FROM: z.string().default('AfriBasket <orders@example.com>'),
  ADMIN_ALERT_EMAIL: z.string().email().default('ops@example.com'),
  STRIPE_SECRET_KEY: optionalUrl,
  STRIPE_WEBHOOK_SECRET: optionalUrl,
  STRIPE_TAX_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  TAX_FLAT_RATE_BPS: z.coerce.number().int().min(0).max(10000).default(0),
  PAYPAL_CLIENT_ID: optionalUrl,
  PAYPAL_CLIENT_SECRET: optionalUrl,
  PAYPAL_WEBHOOK_ID: optionalUrl,
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_API_BASE: z.string().url().default('https://api-m.sandbox.paypal.com'),
  CHECKOUT_SUCCESS_URL: z.string().url().default('http://localhost:5173/checkout/success'),
  CHECKOUT_CANCEL_URL: z.string().url().default('http://localhost:5173/checkout/cancel'),
  FREE_SHIPPING_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(7500),
  COLD_PACK_SURCHARGE_CENTS: z.coerce.number().int().nonnegative().default(800),
  SHIP_CONTIGUOUS_STANDARD_BASE_CENTS: z.coerce.number().int().nonnegative().default(699),
  SHIP_CONTIGUOUS_STANDARD_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(50),
  SHIP_CONTIGUOUS_EXPEDITED_BASE_CENTS: z.coerce.number().int().nonnegative().default(1499),
  SHIP_CONTIGUOUS_EXPEDITED_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(80),
  SHIP_CONTIGUOUS_OVERNIGHT_BASE_CENTS: z.coerce.number().int().nonnegative().default(2999),
  SHIP_CONTIGUOUS_OVERNIGHT_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(120),
  SHIP_AKHI_STANDARD_BASE_CENTS: z.coerce.number().int().nonnegative().default(1499),
  SHIP_AKHI_STANDARD_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(150),
  SHIP_AKHI_EXPEDITED_BASE_CENTS: z.coerce.number().int().nonnegative().default(2999),
  SHIP_AKHI_EXPEDITED_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(200),
  SHIP_TERRITORY_STANDARD_BASE_CENTS: z.coerce.number().int().nonnegative().default(1899),
  SHIP_TERRITORY_STANDARD_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(175),
  SHIP_TERRITORY_EXPEDITED_BASE_CENTS: z.coerce.number().int().nonnegative().default(3499),
  SHIP_TERRITORY_EXPEDITED_PER_LB_CENTS: z.coerce.number().int().nonnegative().default(225),
  SUPER_ADMIN_EMAIL: z.string().email().default('admin@afribasket.test'),
  SUPER_ADMIN_PASSWORD: z.string().min(8).default('ChangeMeNow!123'),
  SUPER_ADMIN_NAME: z.string().default('AfriBasket Super Admin'),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}

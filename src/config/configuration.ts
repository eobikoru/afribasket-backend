import { validateEnv, type Env } from './env.schema';
import { shippingSettingsFromEnv, type ShippingSettings } from '../shipping/shipping.types';

export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  port: number;
  corsOrigins: string[];
  bodyLimit: string;
  storefrontUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshPepper: string;
    refreshTtlDays: number;
  };
  docs: {
    user: string;
    password?: string;
  };
  auth: {
    lockoutMaxAttempts: number;
    lockoutMinutes: number;
    rateLimitMax: number;
    rateLimitWindowSeconds: number;
  };
  reservationMinutes: number;
  cloudinary?: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  email: {
    resendApiKey?: string;
    from: string;
    adminAlert: string;
  };
  stripe: {
    secretKey?: string;
    webhookSecret?: string;
    taxEnabled: boolean;
  };
  taxFlatRateBps: number;
  paypal: {
    clientId?: string;
    clientSecret?: string;
    webhookId?: string;
    mode: 'sandbox' | 'live';
    apiBase: string;
  };
  checkout: {
    successUrl: string;
    cancelUrl: string;
  };
  shipping: ShippingSettings;
  seedAdmin: {
    email: string;
    password: string;
    name: string;
  };
  jobsEnabled: boolean;
}

function uniqueOrigins(values: string[]): string[] {
  return [...new Set(values.map((origin) => origin.trim()).filter((origin) => origin.length > 0))];
}

export function buildConfig(env: Env = validateEnv(process.env)): AppConfig {
  const cloudinary =
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
      ? {
          cloudName: env.CLOUDINARY_CLOUD_NAME,
          apiKey: env.CLOUDINARY_API_KEY,
          apiSecret: env.CLOUDINARY_API_SECRET,
        }
      : undefined;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: uniqueOrigins([
      ...env.CORS_ORIGINS.split(','),
      'https://afrimarket-dashboard.vercel.app',
    ]),
    bodyLimit: env.BODY_LIMIT,
    storefrontUrl: env.STOREFRONT_URL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshPepper: env.REFRESH_TOKEN_PEPPER,
      refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    },
    docs: {
      user: env.DOCS_USER,
      password: env.DOCS_PASSWORD,
    },
    auth: {
      lockoutMaxAttempts: env.AUTH_LOCKOUT_MAX_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
      rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
      rateLimitWindowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    },
    reservationMinutes: env.RESERVATION_MINUTES,
    cloudinary,
    email: {
      resendApiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      adminAlert: env.ADMIN_ALERT_EMAIL,
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      taxEnabled: env.STRIPE_TAX_ENABLED,
    },
    taxFlatRateBps: env.TAX_FLAT_RATE_BPS,
    paypal: {
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      webhookId: env.PAYPAL_WEBHOOK_ID,
      mode: env.PAYPAL_MODE,
      apiBase: env.PAYPAL_API_BASE,
    },
    checkout: {
      successUrl: env.CHECKOUT_SUCCESS_URL,
      cancelUrl: env.CHECKOUT_CANCEL_URL,
    },
    shipping: shippingSettingsFromEnv(env),
    seedAdmin: {
      email: env.SUPER_ADMIN_EMAIL,
      password: env.SUPER_ADMIN_PASSWORD,
      name: env.SUPER_ADMIN_NAME,
    },
    jobsEnabled: env.NODE_ENV === 'test' ? false : env.JOBS_ENABLED,
  };
}

export function configuration(): AppConfig {
  return buildConfig();
}

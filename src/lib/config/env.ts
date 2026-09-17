import { z } from 'zod';

/**
 * Schema for Public environment variables (accessible in browser and server).
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL')
    .default('https://placeholder-project.supabase.co'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required')
    .default('placeholder-anon-key'),
});

/**
 * Schema for Server-Only environment variables (MUST NEVER be bundled in client code).
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APPLICATION_URL: z
    .string()
    .url('APPLICATION_URL must be a valid URL')
    .default('http://localhost:3000'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required')
    .default('placeholder-service-role-key'),
  REDIS_URL: z.string().optional(),
  // Cron worker authentication secret — required in production
  CRON_SECRET: z.string().optional(),
  // Razorpay payment provider credentials — server-only
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
});


export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type Env = PublicEnv & ServerEnv;

/**
 * Validate and parse environment variables.
 */
function parseEnv(): { public: PublicEnv; server: ServerEnv } {
  const publicResult = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!publicResult.success) {
    const formattedErrors = publicResult.error.format();
    throw new Error(
      `Invalid Public Environment Variables: ${JSON.stringify(formattedErrors, null, 2)}`
    );
  }

  // Client-side/browser execution: server-only env variables do not exist in browser bundles
  if (typeof window !== 'undefined') {
    return {
      public: publicResult.data,
      server: {
        NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
        APPLICATION_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
    };
  }

  const serverResult = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    APPLICATION_URL: process.env.APPLICATION_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    REDIS_URL: process.env.REDIS_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  });

  if (!serverResult.success) {
    const formattedErrors = serverResult.error.format();
    throw new Error(
      `Invalid Server Environment Variables: ${JSON.stringify(formattedErrors, null, 2)}`
    );
  }

  // Phase 3E: placeholder credentials must never silently run in production
  // (they would fail obscurely at the database instead of fast at boot).
  if (typeof window === 'undefined' && serverResult.data.NODE_ENV === 'production' && !process.env.CI) {
    const placeholders = [
      publicResult.data.NEXT_PUBLIC_SUPABASE_URL,
      publicResult.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serverResult.data.SUPABASE_SERVICE_ROLE_KEY,
    ];
    if (placeholders.some((v) => v.includes('placeholder'))) {
      throw new Error(
        'Invalid Server Environment Variables: placeholder Supabase credentials are not allowed in production.'
      );
    }
  }

  return {
    public: publicResult.data,
    server: serverResult.data,
  };
}

let parsedEnvCache: { public: PublicEnv; server: ServerEnv } | null = null;

export function getEnv(): { public: PublicEnv; server: ServerEnv } {
  // In test, always re-parse to handle dotenv per-file loading and vitest process reuse
  if (process.env.NODE_ENV === 'test') {
    return parseEnv();
  }
  if (!parsedEnvCache) {
    parsedEnvCache = parseEnv();
  } else if (
    parsedEnvCache.public.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder-project') &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder-project')
  ) {
    parsedEnvCache = parseEnv();
  }
  return parsedEnvCache;
}

/**
 * Helper to reset env cache in test environments.
 */
export function resetEnvCacheForTesting(): void {
  parsedEnvCache = null;
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv, resetEnvCacheForTesting } from '@/lib/config/env';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvCacheForTesting();
  });

  it('should parse default public and server environment variables correctly', () => {
    const env = getEnv();
    expect(env.public.NEXT_PUBLIC_SUPABASE_URL).toBeDefined();
    expect(env.public.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeDefined();
    expect(env.server.NODE_ENV).toBe('test');
    expect(env.server.APPLICATION_URL).toBe('http://localhost:3000');
  });

  it('should throw an error when NEXT_PUBLIC_SUPABASE_URL is invalid', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'invalid-url';
    expect(() => getEnv()).toThrow(/Invalid Public Environment Variables/);
  });
});

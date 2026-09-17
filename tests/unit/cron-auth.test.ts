import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/config/env', () => ({
  getEnv: vi.fn(),
}));

import { getEnv } from '@/lib/config/env';
import { authenticateCronRequest } from '@/lib/cron-auth';

function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set('authorization', authHeader);
  return new NextRequest('http://localhost/api/cron/queue-maintenance', { headers });
}

describe('Cron authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('missing Authorization is rejected with 401', () => {
    vi.mocked(getEnv).mockReturnValue({ server: { CRON_SECRET: 's3cr3t' } } as never);
    const result = authenticateCronRequest(makeRequest(), 'cron_test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('invalid Authorization is rejected with 401 and leaks nothing', async () => {
    vi.mocked(getEnv).mockReturnValue({ server: { CRON_SECRET: 's3cr3t' } } as never);
    const result = authenticateCronRequest(makeRequest('Bearer wrong'), 'cron_test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(JSON.stringify(body)).not.toContain('s3cr3t');
      expect(body.error).toBe('Unauthorized');
    }
  });

  it('query-string secret is not accepted', () => {
    vi.mocked(getEnv).mockReturnValue({ server: { CRON_SECRET: 's3cr3t' } } as never);
    const req = new NextRequest('http://localhost/api/cron/queue-maintenance?secret=s3cr3t');
    const result = authenticateCronRequest(req, 'cron_test');
    expect(result.ok).toBe(false);
  });

  it('valid Authorization is accepted', () => {
    vi.mocked(getEnv).mockReturnValue({ server: { CRON_SECRET: 's3cr3t' } } as never);
    const result = authenticateCronRequest(makeRequest('Bearer s3cr3t'), 'cron_test');
    expect(result.ok).toBe(true);
  });

  it('no secret configured fails safely with 503', async () => {
    vi.mocked(getEnv).mockReturnValue({ server: {} } as never);
    const result = authenticateCronRequest(makeRequest('Bearer anything'), 'cron_test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const body = await result.response.json();
      expect(body.error).toBe('Worker endpoint not configured');
    }
  });
});

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getEnv } from '@/lib/config/env';
import { logger } from '@/lib/logging/logger';

export interface CronAuthSuccess {
  ok: true;
  correlationId: string;
}

export type CronAuthResult =
  | CronAuthSuccess
  | { ok: false; response: NextResponse };

/**
 * Shared production cron authentication.
 * - Bearer <CRON_SECRET> via Authorization header only (never query string).
 * - Constant-time comparison.
 * - 503 when CRON_SECRET is not configured (fail safely, endpoint disabled).
 * - 401 on missing/invalid secret without leaking internals.
 */
export function authenticateCronRequest(req: NextRequest, operation: string): CronAuthResult {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const env = getEnv();
  const cronSecret = env.server.CRON_SECRET;

  if (!cronSecret) {
    logger.error('CRON_SECRET is not configured — worker endpoint is disabled', {
      operation,
      correlationId,
    });
    return {
      ok: false,
      response: NextResponse.json({ error: 'Worker endpoint not configured' }, { status: 503 }),
    };
  }

  const authHeader = req.headers.get('authorization') || '';
  const providedSecret = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  const secretBytes = Buffer.from(cronSecret, 'utf8');
  const providedBytes = Buffer.from(providedSecret, 'utf8');

  const isValid =
    providedSecret.length > 0 &&
    secretBytes.length === providedBytes.length &&
    timingSafeEqual(secretBytes, providedBytes);

  if (!isValid) {
    logger.warn('Unauthorized cron invocation rejected', { operation, correlationId });
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { ok: true, correlationId };
}

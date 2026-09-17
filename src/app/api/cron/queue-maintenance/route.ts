import { NextRequest, NextResponse } from 'next/server';
import { QueueService } from '@/lib/services/queue-service';
import { authenticateCronRequest } from '@/lib/cron-auth';
import { logger } from '@/lib/logging/logger';

/**
 * CRON QUEUE-MAINTENANCE ENDPOINT — PROTECTED BY CRON_SECRET
 *
 * Invokes the authoritative expireOverdueCalledEntries() operation
 * (CALLED -> NO_SHOW for entries past call_timeout_minutes).
 *
 * - Bounded batch (default 50, max 200).
 * - No restaurant_id parameter: scope is determined internally across all
 *   restaurants. Customers cannot trigger arbitrary work.
 * - Does NOT create duplicate outbox events: the RPC already inserts
 *   queue_events + outbox_events atomically per expired row.
 * - Idempotent: re-running finds no overdue rows and expires 0.
 * - Concurrent invocations are safe via FOR UPDATE SKIP LOCKED.
 */
async function handleCronRequest(req: NextRequest): Promise<NextResponse> {
  const auth = authenticateCronRequest(req, 'cron_queue_maintenance');
  if (!auth.ok) return auth.response;
  const { correlationId } = auth;
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('restaurant_id')) {
      logger.warn('Rejected queue-maintenance request with restaurant_id parameter', {
        operation: 'cron_queue_maintenance',
        correlationId,
      });
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);

    logger.info('Cron queue-maintenance starting', {
      operation: 'cron_queue_maintenance',
      correlationId,
      metadata: { limit },
    });

    const { expiredCount } = await QueueService.expireOverdueCalledEntries(limit);

    logger.info('Cron queue-maintenance completed', {
      operation: 'cron_queue_maintenance',
      correlationId,
      metadata: { expiredCount, durationMs: Date.now() - startTime },
    });

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        result: { expiredCount },
      },
      {
        headers: { 'x-correlation-id': correlationId },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Queue maintenance error';
    logger.error('Cron queue-maintenance failed', {
      operation: 'cron_queue_maintenance',
      correlationId,
      metadata: { error: message, durationMs: Date.now() - startTime },
    });
    return NextResponse.json({ error: 'Queue maintenance failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleCronRequest(req);
}

export async function POST(req: NextRequest) {
  return handleCronRequest(req);
}

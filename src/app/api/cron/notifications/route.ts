import { NextRequest, NextResponse } from 'next/server';
import { NotificationWorker } from '@/lib/workers/notification-worker';
import { authenticateCronRequest } from '@/lib/cron-auth';
import { logger } from '@/lib/logging/logger';

/**
 * CRON WORKER ENDPOINT — PROTECTED BY CRON_SECRET
 *
 * Processes the outbox event queue and dispatches notifications.
 * Bounded batch (default 50, max 100). Database is the coordination layer;
 * duplicate invocations are safe via atomic claiming + lease recovery.
 */
async function handleCronRequest(req: NextRequest): Promise<NextResponse> {
  const auth = authenticateCronRequest(req, 'cron_notifications');
  if (!auth.ok) return auth.response;
  const { correlationId } = auth;
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100);

    logger.info('Cron notifications batch starting', {
      operation: 'cron_notifications',
      correlationId,
      metadata: { limit },
    });

    const result = await NotificationWorker.runBatch(limit);

    logger.info('Cron notifications batch completed', {
      operation: 'cron_notifications',
      correlationId,
      metadata: {
        processed: result.processedCount,
        succeeded: result.successCount,
        failed: result.failedCount,
        recoveredStale: result.recoveredStaleCount,
        durationMs: Date.now() - startTime,
      },
    });

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        result,
      },
      {
        headers: { 'x-correlation-id': correlationId },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Worker execution error';
    logger.error('Cron notifications batch failed', {
      operation: 'cron_notifications',
      correlationId,
      metadata: { error: message, durationMs: Date.now() - startTime },
    });
    return NextResponse.json({ error: 'Worker execution failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleCronRequest(req);
}

export async function POST(req: NextRequest) {
  return handleCronRequest(req);
}

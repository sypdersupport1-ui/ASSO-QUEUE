import { NextResponse } from 'next/server';
import { redisClient } from '@/lib/redis';
import { getEnv } from '@/lib/config/env';
import { toSafeErrorResponse } from '@/lib/errors';
import { logger } from '@/lib/logging/logger';
import { createAdminClient } from '@/lib/db/supabase/admin';

type ServiceStatus = 'healthy' | 'degraded' | 'unavailable';

export async function GET(request: Request) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const startTime = Date.now();

  // Phase 3E: unauthenticated DB/Redis probe — bound abuse surface.
  // 60/min per IP is far above any legitimate monitor cadence.
  try {
    const { checkRateLimit, RateLimitEndpointClass, getClientIp } = await import('@/lib/rate-limit');
    const healthLimit = await checkRateLimit({
      identifier: `health:${getClientIp(request)}`,
      limit: 60,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.READ_ONLY,
    });
    if (!healthLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
    }
  } catch {
    // Rate-limiter failure must never take down the health probe itself.
  }

  try {
    const env = getEnv();

    // 1. Database connectivity check
    let dbStatus: ServiceStatus = 'unavailable' as ServiceStatus;
    let dbLatencyMs: number | null = null;
    try {
      const supabase = createAdminClient();
      const dbStart = Date.now();
      const { error } = await supabase
        .from('restaurants')
        .select('id')
        .limit(1);
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = error ? 'unavailable' : 'healthy';
    } catch {
      dbStatus = 'unavailable';
    }

    // 2. Redis check
    let redisStatus: ServiceStatus = 'unavailable' as ServiceStatus;
    let redisLatencyMs: number | null = null;
    try {
      const redisStart = Date.now();
      const writeResult = await redisClient.set('health_check', 'ok', 10);
      const readResult = await redisClient.get('health_check');
      redisLatencyMs = Date.now() - redisStart;

      if (writeResult === 'OK' && readResult === 'ok') {
        // Distinguish real Redis from in-memory fallback based on REDIS_URL config
        redisStatus = env.server.REDIS_URL ? 'healthy' : 'degraded';
      } else {
        redisStatus = 'degraded';
      }
    } catch {
      redisStatus = 'degraded'; // Graceful fallback — app still works
    }

    // 3. Determine overall status
    const redisStatusStr: string = redisStatus;
    const overallStatus: ServiceStatus =
      dbStatus === 'unavailable'
        ? 'unavailable'
        : redisStatusStr === 'unavailable' || redisStatusStr === 'degraded'
        ? 'degraded'
        : 'healthy';

    const httpStatus = overallStatus === 'unavailable' ? 503 : 200;

    logger.info('Healthcheck endpoint queried', {
      operation: 'healthcheck',
      correlationId,
      metadata: {
        status: overallStatus,
        dbStatus,
        redisStatus,
        durationMs: Date.now() - startTime,
      },
    });

    return NextResponse.json(
      {
        success: overallStatus !== 'unavailable',
        data: {
          status: overallStatus,
          version: 'queueflow-v15',
          environment: env.server.NODE_ENV,
          services: {
            database: {
              status: dbStatus,
              latencyMs: dbLatencyMs,
            },
            redis: {
              status: redisStatus,
              configured: Boolean(env.server.REDIS_URL),
              latencyMs: redisLatencyMs,
            },
          },
          timestamp: new Date().toISOString(),
          uptimeMs: process.uptime ? Math.floor(process.uptime() * 1000) : null,
        },
      },
      {
        status: httpStatus,
        headers: {
          'x-correlation-id': correlationId,
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    const { status, body } = toSafeErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

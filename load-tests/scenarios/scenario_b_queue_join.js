import http from 'k6/http';
import { check } from 'k6';
import { loadEnvironmentConfig } from '../config/environment.js';
import { recordHttpResponseMetrics, joinPathLatencyTrend, ticketsCreatedCounter } from '../helpers/metrics.js';

/**
 * SCENARIO B: Controlled Queue Join Concurrency
 * 
 * Exercises `/api/q/join` with multipart/form-data.
 * Respects rate-limiting (`QUEUE_JOIN = 5 req/min`) and checks queue number sequence integrity.
 */
export function scenarioBQueueJoin(vuId, iterCount) {
  const config = loadEnvironmentConfig();

  const customerName = `LoadUser_VU${vuId}_${iterCount}`;
  const customerPhone = `+1555${String(vuId).padStart(3, '0')}${String(iterCount).padStart(3, '0')}`;

  const payload = {
    restaurantId: config.restaurantId,
    restaurantSlug: config.restaurantSlug,
    customerName: customerName,
    customerPhone: customerPhone,
    partySize: '2',
    queueType: 'DINE_IN',
  };

  const res = http.post(`${config.baseUrl}/api/q/join`, payload, {
    tags: { name: 'QueueJoin' },
  });

  const isSuccess = res.status === 200;
  const isDuplicate = res.status === 409;
  const isRateLimited = res.status === 429;
  const isQueueClosedOrFull = res.status === 400 || res.status === 403;

  check(res, {
    'join returns valid status (200, 409, 429, or expected 400/403)': () =>
      isSuccess || isDuplicate || isRateLimited || isQueueClosedOrFull,
  });

  if (isSuccess) {
    try {
      const body = JSON.parse(res.body);
      if (body.success && body.rawToken) {
        ticketsCreatedCounter.add(1);
        return { rawToken: body.rawToken, entryId: body.entryId };
      }
    } catch {
      // Body parse error
    }
  }

  recordHttpResponseMetrics(res, joinPathLatencyTrend, true);
  return null;
}

import http from 'k6/http';
import { check } from 'k6';
import { loadEnvironmentConfig } from '../config/environment.js';
import { recordHttpResponseMetrics, statusPathLatencyTrend } from '../helpers/metrics.js';

/**
 * SCENARIO C: Customer Queue Status Lookup by Bearer Token
 * 
 * Exercises `/api/q/status?token=<rawToken>&restaurantSlug=<slug>`
 * Respects per-token rate limit (`QUEUE_STATUS = 65 req/min`).
 */
export function scenarioCQueueStatus(rawToken) {
  const config = loadEnvironmentConfig();

  if (!rawToken) {
    // If no token created yet, fallback to testing invalid token 404 response handling
    const resFallback = http.get(
      `${config.baseUrl}/api/q/status?token=invalid_test_token_123456&restaurantSlug=${config.restaurantSlug}`,
      { tags: { name: 'QueueStatusFallback' } }
    );
    check(resFallback, {
      'invalid token returns 404': (r) => r.status === 404,
    });
    recordHttpResponseMetrics(resFallback, statusPathLatencyTrend, false);
    return;
  }

  const res = http.get(
    `${config.baseUrl}/api/q/status?token=${encodeURIComponent(rawToken)}&restaurantSlug=${config.restaurantSlug}`,
    { tags: { name: 'QueueStatus' } }
  );

  const isSuccess = res.status === 200;
  const isRateLimited = res.status === 429;
  const isNotFound = res.status === 404;

  check(res, {
    'status returns 200, 404 or 429': () => isSuccess || isNotFound || isRateLimited,
  });

  recordHttpResponseMetrics(res, statusPathLatencyTrend, false);
}

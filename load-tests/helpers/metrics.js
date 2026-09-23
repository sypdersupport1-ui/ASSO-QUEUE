import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * ASSO Queue Load Testing Custom Metrics Harness
 * 
 * Enforces dual-priority evaluation: PERFORMANCE + CORRECTNESS.
 * Distinguishes expected 429 rate-limiting from unexpected application 5xx failures.
 */

// Latency & Performance Trends
export classNameLatencyTrend = new Trend('read_path_latency_ms', true);
export const joinPathLatencyTrend = new Trend('join_path_latency_ms', true);
export const statusPathLatencyTrend = new Trend('status_path_latency_ms', true);

// Counters
export const totalRequestsCounter = new Counter('total_http_requests');
export const successCounter = new Counter('successful_http_requests');
export const rateLimitCounter = new Counter('rate_limited_429_requests');
export const applicationErrorCounter = new Counter('unexpected_app_errors_5xx');

// Correctness & Business Logic Metrics
export const ticketsCreatedCounter = new Counter('tickets_created_count');
export const duplicateTicketCounter = new Counter('duplicate_active_entry_409');
export const idempotencySuccessCounter = new Counter('idempotent_replays_count');

// Rates
export const successRate = new Rate('success_rate');
export const correctnessRate = new Rate('correctness_rate');

/**
 * Helper to record standard HTTP response metrics cleanly
 */
export function recordHttpResponseMetrics(res, trendMetric, isStateMutation = false) {
  totalRequestsCounter.add(1);

  if (trendMetric) {
    trendMetric.add(res.timings.duration);
  }

  const isSuccess = res.status >= 200 && res.status < 300;
  const isRateLimited = res.status === 429;
  const is5xx = res.status >= 500;
  const isDuplicate409 = res.status === 409;

  successRate.add(isSuccess || isRateLimited || isDuplicate409 ? 1 : 0);
  correctnessRate.add(is5xx ? 0 : 1);

  if (isSuccess) {
    successCounter.add(1);
  } else if (isRateLimited) {
    rateLimitCounter.add(1);
  } else if (is5xx) {
    applicationErrorCounter.add(1);
  } else if (isDuplicate409 && isStateMutation) {
    duplicateTicketCounter.add(1);
  }
}

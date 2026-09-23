import http from 'k6/http';
import { check } from 'k6';
import { loadEnvironmentConfig } from '../config/environment.js';
import { recordHttpResponseMetrics, classNameLatencyTrend } from '../helpers/metrics.js';

/**
 * SCENARIO A: Public Metadata & Health Read Path
 * 
 * Exercises:
 * 1. Health check probe (`/api/health`)
 * 2. Public restaurant menu page route (`/q/${restaurantSlug}`)
 * 
 * Observes CacheService hit/miss performance & read rate-limit protection.
 */
export function scenarioAPublicRead() {
  const config = loadEnvironmentConfig();

  // 1. Health Probe
  const healthRes = http.get(`${config.baseUrl}/api/health`, {
    headers: { 'Accept': 'application/json' },
    tags: { name: 'HealthCheck' },
  });

  check(healthRes, {
    'health status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
  recordHttpResponseMetrics(healthRes, classNameLatencyTrend, false);

  // 2. Public Restaurant Menu Read
  const menuRes = http.get(`${config.baseUrl}/q/${config.restaurantSlug}`, {
    headers: { 'Accept': 'text/html,application/xhtml+xml' },
    tags: { name: 'PublicMenuRead' },
  });

  check(menuRes, {
    'public page status is 200': (r) => r.status === 200,
  });
  recordHttpResponseMetrics(menuRes, classNameLatencyTrend, false);
}

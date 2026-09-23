import { sleep } from 'k6';
import { scenarioAPublicRead } from './scenario_a_public_read.js';
import { scenarioBQueueJoin } from './scenario_b_queue_join.js';
import { scenarioCQueueStatus } from './scenario_c_queue_status.js';
import { loadEnvironmentConfig } from '../config/environment.js';

/**
 * 10-VU BASELINE SMOKE TEST HARNESS
 * 
 * Target: 10 VUs max, 30s duration.
 * Environment Guard: Active (refuses execution against 'production').
 */
export const options = {
  stages: [
    { duration: '5s', target: 5 },   // Warmup to 5 VUs
    { duration: '20s', target: 10 }, // Hold steady at 10 VUs
    { duration: '5s', target: 0 },   // Cool down
  ],
  thresholds: {
    'unexpected_app_errors_5xx': ['count<1'], // 0 tolerance for 5xx server errors
    'correctness_rate': ['rate>0.99'],        // 99%+ logical correctness rate
    'read_path_latency_ms': ['p(95)<500'],    // 95% reads under 500ms
    'join_path_latency_ms': ['p(95)<1000'],   // 95% joins under 1000ms
    'status_path_latency_ms': ['p(95)<500'],  // 95% status lookups under 500ms
  },
};

export function setup() {
  const config = loadEnvironmentConfig();
  console.log(`[LOAD TEST HARNESS] Initializing 10-VU Smoke Test against target: ${config.baseUrl} (Env: ${config.environment})`);
  return { config };
}

export default function (data) {
  const vuId = __VU;
  const iterCount = __ITER;

  // 1. Read Path (Public Metadata)
  scenarioAPublicRead();
  sleep(1);

  // 2. State Mutation Path (Queue Join - controlled pace)
  const joinResult = scenarioBQueueJoin(vuId, iterCount);
  sleep(1);

  // 3. Status Lookup Path (Queue Status)
  const tokenToTest = joinResult ? joinResult.rawToken : null;
  scenarioCQueueStatus(tokenToTest);
  sleep(1);
}

export function teardown(data) {
  console.log('[LOAD TEST HARNESS] 10-VU Smoke Test execution completed.');
}

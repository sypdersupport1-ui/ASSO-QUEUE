/**
 * ASSO Queue Load Testing Environment Guard & Configuration
 * 
 * Safety Contract:
 * Refuses execution if LOAD_TEST_ENVIRONMENT is set to 'production'
 * or if LOAD_TEST_BASE_URL points to a production domain without explicit override.
 */

export function loadEnvironmentConfig() {
  const envName = (__ENV.LOAD_TEST_ENVIRONMENT || 'local').toLowerCase().trim();
  const baseUrl = (__ENV.LOAD_TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

  // Safety Guard: Absolute prohibition of silent production execution
  if (envName === 'production') {
    throw new Error(
      `[LOAD TEST SAFETY GUARD] Execution refused! Target environment is explicitly set to 'production'. ` +
      `High-volume load tests must NEVER run against production databases or endpoints.`
    );
  }

  // Safety Guard: Production URL protection
  const forbiddenDomains = ['assoqueue.com', 'queueflow.com', 'queue.vercel.app'];
  if (forbiddenDomains.some((domain) => baseUrl.toLowerCase().includes(domain))) {
    throw new Error(
      `[LOAD TEST SAFETY GUARD] Execution refused! Target URL '${baseUrl}' appears to be a production endpoint. ` +
      `Load tests may only target isolated local, test, or staging environments.`
    );
  }

  return {
    environment: envName,
    baseUrl: baseUrl,
    restaurantSlug: __ENV.LOAD_TEST_RESTAURANT_SLUG || 'biriyani-house',
    restaurantId: __ENV.LOAD_TEST_RESTAURANT_ID || '00000000-0000-0000-0000-000000000001',
    // Known rate limit thresholds for rate-limit awareness
    limits: {
      READ_ONLY: 60,
      QUEUE_JOIN: 5,
      QUEUE_STATUS: 65,
    },
  };
}

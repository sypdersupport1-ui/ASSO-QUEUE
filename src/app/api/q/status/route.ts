import 'server-only';
import { checkRateLimit, RateLimitEndpointClass, fingerprintQueueToken } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { QueueService } from '@/lib/services/queue-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { logger } from '@/lib/logging/logger';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const restaurantSlug = searchParams.get('restaurantSlug');

    if (!token) {
      return customerJson({ error: 'Missing customer token' }, 400);
    }

    // Fingerprint the raw token (SHA-256) — never store raw token in Redis key
    const tokenFingerprint = fingerprintQueueToken(token);

    // Rate limiting: queue status ~30 requests/minute/token
    // Key format: rl:queue:status:<tokenFingerprint>
    // Per-token rate limiting ensures abusive clients cannot bypass by changing IP
    const identifier = `rl:queue:status:${tokenFingerprint}`;

    const rateLimitConfig = {
      identifier,
      limit: 30, // RateLimitLimit.QUEUE_STATUS
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.TOKEN_AUTHENTICATED,
    };

    const rateResult = await checkRateLimit(rateLimitConfig);

    if (!rateResult.allowed) {
      return customerJson(
        { error: 'Too many requests. Please try again shortly.' },
        429,
        { 'Retry-After': '60' }
      );
    }

    // Token validation — database lookup (authoritative). restaurantSlug is
    // only cross-checked, never trusted as authorization.
    const queueStatus = await QueueService.getQueueStatusByToken(token);

    if (!queueStatus) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    // Tenant isolation check via restaurant slug (generic errors only —
    // never reveal whether the mismatch is the slug or the token).
    if (restaurantSlug) {
      const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
      if (!restaurant || restaurant.id !== queueStatus.restaurantId) {
        return customerJson({ error: 'Invalid or expired token.' }, 404);
      }
    }

    return customerJson({ status: queueStatus }, 200, rateResult.headers);
  } catch (err) {
    logger.error('Queue status API error', {
      operation: 'queue_status_api_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return customerJson({ error: 'Internal server error.' }, 500);
  }
}
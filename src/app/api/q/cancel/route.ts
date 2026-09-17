import 'server-only';
import { checkRateLimit, RateLimitEndpointClass, fingerprintQueueToken } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { QueueService } from '@/lib/services/queue-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { logger } from '@/lib/logging/logger';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const token = formData.get('token') as string;
    const restaurantSlug = formData.get('restaurantSlug') as string;

    if (!token || !restaurantSlug) {
      return customerJson({ error: 'Missing required fields.' }, 400);
    }

    // Fingerprint the raw token (SHA-256) — never store raw token in Redis key
    const tokenFingerprint = fingerprintQueueToken(token);

    // Rate limiting: queue cancel ~10 requests/minute/token
    // Key format: rl:queue:cancel:<tokenFingerprint>
    // Per-token rate limiting — the same raw token should not exist across
    // different restaurants (tokens are generated per-restaurant), so this
    // provides implicit tenant isolation without needing restaurantId upfront.
    // Changing restaurant slugs won't bypass the limit because the token
    // fingerprint is tied to the specific ticket.
    const identifier = `rl:queue:cancel:${tokenFingerprint}`;

    const rateLimitConfig = {
      identifier,
      limit: 10,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.STATE_CHANGING,
    };

    const rateResult = await checkRateLimit(rateLimitConfig);

    if (!rateResult.allowed) {
      return customerJson(
        { error: 'Too many requests. Please try again shortly.' },
        429,
        { 'Retry-After': '60' }
      );
    }

    // Token validation — database lookup (authoritative). The authorized
    // entry is derived SOLELY from hash(token); restaurantSlug is only
    // cross-checked, never trusted as authorization.
    const queueStatus = await QueueService.getQueueStatusByToken(token);
    if (!queueStatus) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    // Tenant isolation check
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== queueStatus.restaurantId) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    // Authoritative cancellation (FSM + atomic RPC enforce allowed states
    // and race safety; anon callers may only reach CANCELLED).
    try {
      await QueueService.updateQueueStatus({
        entryId: queueStatus.entryId,
        newStatus: 'CANCELLED',
      });

      return customerJson({ success: true }, 200);
    } catch {
      // Generic message: raw transition/DB errors must never reach callers.
      return customerJson({ error: 'Failed to cancel queue entry.' }, 500);
    }
  } catch (err) {
    logger.error('Queue cancel API error', {
      operation: 'queue_cancel_api_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return customerJson({ error: 'Internal server error.' }, 500);
  }
}
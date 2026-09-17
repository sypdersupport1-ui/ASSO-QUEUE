import 'server-only';
import { checkRateLimit, RateLimitEndpointClass, getClientIp, generateQueueJoinIdentifier } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { QueueService } from '@/lib/services/queue-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { logger } from '@/lib/logging/logger';

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const formData = await request.formData();
    const restaurantId = formData.get('restaurantId') as string;
    const restaurantSlug = formData.get('restaurantSlug') as string;
    const customerName = (formData.get('customerName') as string || '').trim();
    const customerPhone = (formData.get('customerPhone') as string || '').trim();
    const partySize = parseInt(formData.get('partySize') as string || '1', 10);

    if (!restaurantId || !restaurantSlug) {
      return customerJson({ error: 'Invalid restaurant context.' }, 400);
    }

    // Rate limiting: queue join ~5 requests/minute/IP/restaurant
    // Key format: rl:queue:join:<restaurantId>:<ip> (tenant-scoped)
    const identifier = generateQueueJoinIdentifier(restaurantId, ip);

    const rateLimitConfig = {
      identifier,
      limit: 5,
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

    // Basic authorization/validation (tenant isolation, operating hours, capacity)
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant) {
      return customerJson({ error: 'Restaurant not found.' }, 404);
    }

    // Phase 3E: the client-supplied restaurantId must match the slug-derived
    // restaurant — never join a different tenant than the one displayed.
    if (restaurant.id !== restaurantId) {
      return customerJson({ error: 'Invalid restaurant context.' }, 400);
    }

    if (restaurant.queueEnabled === false) {
      return customerJson({ error: 'Queue is currently disabled for this restaurant.' }, 403);
    }

    // Authoritative join — database constraint remains authoritative
    try {
      const result = await QueueService.joinQueue({
        restaurantId: restaurant.id,
        customerName,
        customerPhone: customerPhone || undefined,
        partySize,
      });

      // Success — return token for UI redirect
      return customerJson({ success: true, rawToken: result.rawToken, entryId: result.entry?.id }, 200);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Duplicate active entry — customer already waiting
      if (message.includes('DUPLICATE_ACTIVE_ENTRY')) {
        return customerJson(
          { error: "You are already waiting in line for this restaurant! Check your existing ticket." },
          409
        );
      }
      if (message.includes('QUEUE_OUTSIDE_OPERATING_HOURS')) {
        return customerJson(
          { error: 'The queue is currently closed. Please check the operating hours and try again later.' },
          400
        );
      }
      if (message.includes('QUEUE_PAUSED')) {
        return customerJson(
          { error: 'The queue is temporarily paused. Please check back shortly.' },
          400
        );
      }
      if (message.includes('QUEUE_FULL')) {
        return customerJson(
          { error: 'The queue is currently full. Please try again shortly.' },
          400
        );
      }

      // Generic error — do not expose database details
      return customerJson({ error: 'Failed to join queue. Please try again.' }, 500);
    }
  } catch (err) {
    logger.error('Queue join API error', {
      operation: 'queue_join_api_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return customerJson({ error: 'Internal server error.' }, 500);
  }
}
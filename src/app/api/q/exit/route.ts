import 'server-only';
import { checkRateLimit, RateLimitEndpointClass, fingerprintQueueToken } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { QueueService } from '@/lib/services/queue-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { clearTicketCookie } from '@/lib/customer-ticket-cookie';
import { logger } from '@/lib/logging/logger';

export async function POST(request: Request) {
  try {
    let token = '';
    let restaurantSlug = '';

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      token = body.token || '';
      restaurantSlug = body.restaurantSlug || '';
    } else {
      const formData = await request.formData();
      token = (formData.get('token') as string) || '';
      restaurantSlug = (formData.get('restaurantSlug') as string) || '';
    }

    if (!token || !restaurantSlug) {
      return customerJson({ error: 'Missing required fields.' }, 400);
    }

    const tokenFingerprint = fingerprintQueueToken(token);
    const identifier = `rl:queue:exit:${tokenFingerprint}`;

    const rateResult = await checkRateLimit({
      identifier,
      limit: 10,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.STATE_CHANGING,
    });

    if (!rateResult.allowed) {
      return customerJson(
        { error: 'Too many requests. Please try again shortly.' },
        429,
        { 'Retry-After': '60' }
      );
    }

    const queueStatus = await QueueService.getQueueStatusByToken(token);
    if (!queueStatus) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== queueStatus.restaurantId) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    await QueueService.exitSeatedCustomer(queueStatus.entryId);
    await clearTicketCookie(restaurantSlug);

    return customerJson({
      success: true,
      message: 'Dining completed. Thank you for dining with us!',
    }, 200);
  } catch (err: unknown) {
    logger.error('Failed to process customer dining exit', {
      operation: 'api_queue_exit',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return customerJson({ error: 'Internal server error.' }, 500);
  }
}

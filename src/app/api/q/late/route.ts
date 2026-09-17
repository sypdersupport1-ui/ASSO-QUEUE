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
    const delayMinutes = Number(formData.get('delayMinutes') || 10);
    const note = (formData.get('note') as string) || '';

    if (!token || !restaurantSlug) {
      return customerJson({ error: 'Missing required fields.' }, 400);
    }

    const tokenFingerprint = fingerprintQueueToken(token);
    const identifier = `rl:queue:late:${tokenFingerprint}`;

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

    const result = await QueueService.recordCustomerLate(token, delayMinutes, note);

    logger.info('Customer marked running late', {
      operation: 'queue_customer_late',
      restaurantId: restaurant.id,
      metadata: { entryId: queueStatus.entryId, delayMinutes, note },
    });

    return customerJson(result, 200);
  } catch (err) {
    logger.error('Failed to record customer late', {
      operation: 'queue_customer_late',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return customerJson({ error: 'Could not submit update. Please try again.' }, 500);
  }
}

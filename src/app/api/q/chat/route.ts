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
    const message = (formData.get('message') as string) || '';

    if (!token || !restaurantSlug || !message.trim()) {
      return customerJson({ error: 'Missing required fields.' }, 400);
    }

    const tokenFingerprint = fingerprintQueueToken(token);
    const identifier = `rl:queue:chat:${tokenFingerprint}`;

    const rateResult = await checkRateLimit({
      identifier,
      limit: 20,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.STATE_CHANGING,
    });

    if (!rateResult.allowed) {
      return customerJson(
        { error: 'Too many messages. Please wait a moment.' },
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

    const result = await QueueService.sendQueueChatMessage({
      rawToken: token,
      sender: 'customer',
      senderName: queueStatus.customerName || 'Guest',
      message: message.trim(),
    });

    return customerJson(result, 200);
  } catch (err) {
    logger.error('Failed to send queue chat message', {
      operation: 'queue_chat_message',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return customerJson({ error: 'Could not send message. Please try again.' }, 500);
  }
}

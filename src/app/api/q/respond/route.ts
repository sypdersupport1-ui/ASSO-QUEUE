import 'server-only';
import { checkRateLimit, RateLimitEndpointClass, fingerprintQueueToken } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { QueueService } from '@/lib/services/queue-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { logger } from '@/lib/logging/logger';

export async function POST(request: Request) {
  try {
    let token = '';
    let restaurantSlug = '';
    let response = '';
    let delayMinutes: number | undefined;

    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      if (!token) token = String(body.token || '');
      restaurantSlug = String(body.restaurantSlug || '');
      response = String(body.response || '');
      if (body.delayMinutes !== undefined) delayMinutes = Number(body.delayMinutes);
    } else {
      const formData = await request.formData();
      if (!token) token = (formData.get('token') as string) || '';
      restaurantSlug = (formData.get('restaurantSlug') as string) || '';
      response = (formData.get('response') as string) || '';
      const delayRaw = formData.get('delayMinutes');
      if (delayRaw !== null) delayMinutes = Number(delayRaw);
    }

    if (!token || !restaurantSlug || !response) {
      return customerJson({ error: 'Missing required fields.' }, 400);
    }

    if (!['ACCEPTED', 'DELAY_REQUESTED', 'DECLINED'].includes(response)) {
      return customerJson({ error: 'Invalid response type.' }, 400);
    }

    if (response === 'DELAY_REQUESTED' && delayMinutes !== undefined) {
      if (delayMinutes < 1 || delayMinutes > 60) {
        return customerJson({ error: 'INVALID_DELAY_MINUTES', message: 'Delay must be between 1 and 60 minutes.' }, 400);
      }
    }

    const tokenFingerprint = fingerprintQueueToken(token);
    const identifier = `rl:queue:respond:${tokenFingerprint}`;

    const rateResult = await checkRateLimit({
      identifier,
      limit: 15,
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

    // Authoritative token check
    const queueStatus = await QueueService.getQueueStatusByToken(token);
    if (!queueStatus) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    // Tenant isolation verification
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== queueStatus.restaurantId) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    try {
      const result = await QueueService.respondToCall(
        token,
        response as 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED',
        delayMinutes
      );

      logger.info('Customer responded to table call', {
        operation: 'queue_call_response',
        restaurantId: restaurant.id,
        metadata: { entryId: queueStatus.entryId, response, delayMinutes },
      });

      return customerJson(result, 200);
    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      if (msg.includes('CALL_EXPIRED')) {
        return customerJson(
          { error: 'CALL_EXPIRED', message: 'This table call has expired.' },
          410
        );
      }
      if (msg.includes('QUEUE_ENTRY_NOT_CALLED')) {
        return customerJson(
          { error: 'NOT_CALLED', message: 'Entry is not currently called.' },
          409
        );
      }
      if (msg.includes('UNAUTHORIZED')) {
        return customerJson({ error: 'Invalid or expired token.' }, 404);
      }
      throw innerErr;
    }
  } catch (err) {
    logger.error('Failed to process call response', {
      operation: 'queue_call_response_error',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return customerJson({ error: 'Could not process response. Please try again.' }, 500);
  }
}

import 'server-only';
import { NextRequest } from 'next/server';
import { checkRateLimit, RateLimitEndpointClass, fingerprintQueueToken } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { QueueService } from '@/lib/services/queue-service';
import { NotificationService } from '@/lib/services/notification-service';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return customerJson({ error: 'Missing customer token' }, 400);
    }

    // Rate limiting: customer notifications ~60 requests/minute/token
    // Read-only endpoint — graceful fallback acceptable if Redis fails
    const tokenFingerprint = fingerprintQueueToken(token);

    const identifier = `rl:queue:notifications:${tokenFingerprint}`;

    const rateLimitConfig = {
      identifier,
      limit: 60,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.READ_ONLY,
    };

    const rateResult = await checkRateLimit(rateLimitConfig);

    if (!rateResult.allowed) {
      return customerJson(
        { error: 'Too many requests. Please try again shortly.' },
        429,
        { 'Retry-After': '60' }
      );
    }

    // Token validation — database lookup (authoritative). Notifications are
    // scoped to the derived entry+restaurant; no client ids are trusted.
    const queueStatus = await QueueService.getQueueStatusByToken(token);

    if (!queueStatus) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    const notifications = await NotificationService.getCustomerNotificationsByQueueId(
      queueStatus.entryId,
      queueStatus.restaurantId
    );

    return customerJson({ notifications }, 200, rateResult.headers);
  } catch {
    // Generic message: raw failures must never reach callers.
    return customerJson({ error: 'Failed to fetch customer notifications' }, 500);
  }
}

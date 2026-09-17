import 'server-only';
import { checkRateLimit, RateLimitEndpointClass, fingerprintQueueToken } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { OrderService } from '@/lib/services/order-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { logger } from '@/lib/logging/logger';

/**
 * Phase 3D — customer order lookup by order bearer token.
 *
 * Wires the existing `/q/[slug]/payment/[orderToken]` page reference.
 * Authorization is derived SOLELY from hash(token) -> orders.order_token_hash;
 * `slug` is only cross-checked, never trusted. Response is minimized to
 * what the payment UI needs (no customer phone, no raw token, no internals)
 * and marked private/no-store.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const slug = searchParams.get('slug');

    if (!token) {
      return customerJson({ error: 'Missing order token' }, 400);
    }

    // Rate limiting: order status ~30 requests/minute/token (same class as
    // queue status polling). Fingerprint only — raw token never in Redis.
    const rateResult = await checkRateLimit({
      identifier: `rl:order:status:${fingerprintQueueToken(token)}`,
      limit: 30,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.TOKEN_AUTHENTICATED,
    });

    if (!rateResult.allowed) {
      return customerJson(
        { error: 'Too many requests. Please try again shortly.' },
        429,
        { 'Retry-After': '60' }
      );
    }

    const orderState = await OrderService.getCustomerOrderStateByToken(token);
    if (!orderState) {
      return customerJson({ error: 'Invalid or expired token.' }, 404);
    }

    if (slug) {
      const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
      if (!restaurant || restaurant.id !== orderState.restaurantId) {
        return customerJson({ error: 'Invalid or expired token.' }, 404);
      }
    }

    return customerJson(
      {
        order: {
          id: orderState.orderId,
          order_number: orderState.orderNumber,
          total: orderState.total,
          restaurant_id: orderState.restaurantId,
          restaurant_name: orderState.restaurantName,
          restaurant_currency: orderState.restaurantCurrency,
          status: orderState.status,
          payment_status: orderState.paymentStatus,
          subtotal: orderState.subtotal,
          tax: orderState.tax,
          items: orderState.items,
        },
      },
      200,
      rateResult.headers
    );
  } catch (err) {
    logger.error('Customer order API error', {
      operation: 'customer_order_api_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return customerJson({ error: 'Internal server error.' }, 500);
  }
}

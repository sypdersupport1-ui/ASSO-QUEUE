import { NextRequest } from 'next/server';
import { PaymentService } from '@/lib/services/payment-service';
import {
  checkRateLimit,
  RateLimitEndpointClass,
  fingerprintQueueToken,
  getClientIp,
} from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import {
  authorizeCustomerOrder,
  isOrderPayable,
} from '@/lib/customer-order-auth';
import { logger } from '@/lib/logging/logger';
import type { PaymentMethod } from '@/types/database.types';

/**
 * Phase 3D correction — customer payment intent creation.
 *
 * Authorization chain (UUIDs are identifiers, NEVER authorization):
 *   body.orderToken -> SHA-256 -> orders.order_token_hash -> order row
 *   -> client orderId/restaurantId cross-checked against the derived row
 *   -> order must be payable (not CANCELLED, not already PAID)
 * Only then is the intent created, using SERVER-DERIVED ids.
 */
export async function POST(req: NextRequest) {
  // 1. Rate limits first (before any DB work): per-IP spray protection plus
  //    per-credential focus protection. Fingerprint only — never raw tokens.
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit({
    identifier: `payment_intent:${ip}`,
    limit: 5,
    windowSeconds: 60,
    endpointClass: RateLimitEndpointClass.HIGH_COST,
  });
  if (!ipLimit.allowed) {
    return customerJson(
      { error: 'Too many payment requests. Please wait a moment and try again.' },
      429,
      { 'Retry-After': '60' }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return customerJson({ error: 'Invalid request.' }, 400);
  }

  const orderToken = body.orderToken as string | undefined;
  const orderId = body.orderId as string | undefined;
  const restaurantId = body.restaurantId as string | undefined;
  const paymentMethod = body.paymentMethod as string | undefined;
  const idempotencyKey = body.idempotencyKey as string | undefined;
  const currency = (body.currency as string | undefined) || 'INR';

  if (!orderToken || !paymentMethod) {
    return customerJson(
      { error: 'Missing required parameters: orderToken, paymentMethod' },
      400
    );
  }

  let fingerprint: string;
  try {
    fingerprint = fingerprintQueueToken(orderToken);
  } catch {
    return customerJson({ error: 'Order not found.' }, 404);
  }
  const tokenLimit = await checkRateLimit({
    identifier: `rl:payment:intent:${fingerprint}`,
    limit: 5,
    windowSeconds: 60,
    endpointClass: RateLimitEndpointClass.HIGH_COST,
  });
  if (!tokenLimit.allowed) {
    return customerJson(
      { error: 'Too many payment requests. Please wait a moment and try again.' },
      429,
      { 'Retry-After': '60' }
    );
  }

  // 2. Authenticate: derive the order from the credential, cross-check ids.
  const ctx = await authorizeCustomerOrder(orderToken, { orderId, restaurantId });
  if (!ctx || !isOrderPayable(ctx)) {
    return customerJson({ error: 'Order not found.' }, 404);
  }

  if (!['ONLINE', 'PAY_AT_RESTAURANT', 'CASH', 'MANUAL'].includes(paymentMethod)) {
    return customerJson({ error: 'Missing required parameters: orderToken, paymentMethod' }, 400);
  }

  try {
    const result = await PaymentService.createPaymentIntent({
      restaurantId: ctx.restaurantId,
      orderId: ctx.orderId,
      amount: 0, // Authoritative calculation handles this on server
      paymentMethod: paymentMethod as PaymentMethod,
      idempotencyKey,
      currency,
    });

    return customerJson(result, 200);
  } catch (err) {
    logger.error('Customer payment intent failed', {
      operation: 'payment_intent',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return customerJson({ error: 'Failed to create payment intent' }, 400);
  }
}

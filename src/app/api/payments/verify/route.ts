import { NextRequest } from 'next/server';
import { PaymentService } from '@/lib/services/payment-service';
import {
  checkRateLimit,
  RateLimitEndpointClass,
  fingerprintQueueToken,
  getClientIp,
} from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { authorizeCustomerOrder } from '@/lib/customer-order-auth';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { logger } from '@/lib/logging/logger';

/**
 * Phase 3D correction — customer payment verification.
 *
 * Authorization chain: body.orderToken authenticates the order; the
 * payment row is then bound to that order (payment.order_id must equal
 * the authorized order id AND share its restaurant). Payment IDs and
 * provider references are identifiers only — a forged provider payload
 * for another customer's payment fails closed here, before any provider
 * signature check or state mutation.
 */
export async function POST(req: NextRequest) {
  // 1. Rate limits first: per-IP spray protection plus per-credential focus
  //    protection. Fingerprint only — never raw tokens.
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit({
    identifier: `payment_verify:${ip}`,
    limit: 10,
    windowSeconds: 60,
    endpointClass: RateLimitEndpointClass.HIGH_COST,
  });
  if (!ipLimit.allowed) {
    return customerJson(
      { error: 'Too many verification requests. Please try again shortly.' },
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
  const paymentId = body.paymentId as string | undefined;
  const providerPaymentId = body.providerPaymentId as string | undefined;
  const providerOrderId = body.providerOrderId as string | undefined;
  const providerSignature = body.providerSignature as string | undefined;

  if (!orderToken || !paymentId) {
    return customerJson({ error: 'Missing orderToken, paymentId' }, 400);
  }

  let fingerprint: string;
  try {
    fingerprint = fingerprintQueueToken(orderToken);
  } catch {
    return customerJson({ error: 'Order not found.' }, 404);
  }
  const tokenLimit = await checkRateLimit({
    identifier: `rl:payment:verify:${fingerprint}`,
    limit: 10,
    windowSeconds: 60,
    endpointClass: RateLimitEndpointClass.HIGH_COST,
  });
  if (!tokenLimit.allowed) {
    return customerJson(
      { error: 'Too many verification requests. Please try again shortly.' },
      429,
      { 'Retry-After': '60' }
    );
  }

  // 2. Locate the payment, then bind it to the authorized order context.
  const supabase = createAdminClient();
  const { data: payment } = await supabase
    .from('payments')
    .select('id, order_id, restaurant_id, status')
    .eq('id', paymentId)
    .maybeSingle();

  if (!payment) {
    return customerJson({ error: 'Order not found.' }, 404);
  }

  const ctx = await authorizeCustomerOrder(orderToken, {
    orderId: payment.order_id,
    restaurantId: payment.restaurant_id,
  });
  if (!ctx) {
    return customerJson({ error: 'Order not found.' }, 404);
  }

  try {
    const result = await PaymentService.verifyAndProcessPayment({
      paymentId: payment.id,
      providerPaymentId,
      providerOrderId,
      providerSignature,
    });

    if (!result.success) {
      return customerJson(
        { error: result.errorMessage || 'Payment verification failed', result },
        400
      );
    }

    return customerJson(result, 200);
  } catch (err) {
    logger.error('Customer payment verification failed', {
      operation: 'payment_verify',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return customerJson({ error: 'Failed to verify payment' }, 400);
  }
}

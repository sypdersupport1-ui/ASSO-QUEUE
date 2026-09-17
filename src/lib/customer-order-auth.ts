import 'server-only';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { hashQueueToken } from '@/lib/utils/token-utils';

/**
 * Phase 3D correction — one authoritative customer authorization path for
 * anonymous payment operations.
 *
 * Chain: raw order token -> SHA-256 -> orders.order_token_hash -> order row
 * -> (queue_entry_id, restaurant_id). Caller-supplied order UUIDs,
 * restaurant ids, payment ids, and provider references are NEVER trusted
 * as authorization — they are only cross-checked against the derived row.
 *
 * No token, id, phone, or name is ever logged here.
 */
export interface CustomerOrderContext {
  orderId: string;
  restaurantId: string;
  queueEntryId: string | null;
  orderStatus: string;
  paymentStatus: string;
}

/**
 * Authenticate an anonymous customer payment request.
 * Returns the authorized order context, or null (caller maps to a generic
 * not-found response — never reveal which check failed).
 */
export async function authorizeCustomerOrder(
  rawOrderToken: string | null | undefined,
  expected?: { orderId?: string | null; restaurantId?: string | null }
): Promise<CustomerOrderContext | null> {
  if (!rawOrderToken || typeof rawOrderToken !== 'string') return null;

  let tokenHash: string;
  try {
    tokenHash = hashQueueToken(rawOrderToken);
  } catch {
    return null;
  }

  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, restaurant_id, queue_entry_id, status, payment_status')
    .eq('order_token_hash', tokenHash)
    .maybeSingle();

  if (!order) return null;
  if (expected?.orderId && expected.orderId !== order.id) return null;
  if (expected?.restaurantId && expected.restaurantId !== order.restaurant_id) {
    return null;
  }

  return {
    orderId: order.id,
    restaurantId: order.restaurant_id,
    queueEntryId: order.queue_entry_id,
    orderStatus: order.status,
    paymentStatus: order.payment_status,
  };
}

/**
 * Payment eligibility for an authorized order. Only non-cancelled,
 * unpaid orders may take new payment intents. Pure function — unit tested.
 */
export function isOrderPayable(ctx: CustomerOrderContext): boolean {
  if (ctx.orderStatus === 'CANCELLED') return false;
  if (ctx.paymentStatus === 'PAID') return false;
  return true;
}

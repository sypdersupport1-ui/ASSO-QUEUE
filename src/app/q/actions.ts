'use server';

import { QueueService } from '@/lib/services/queue-service';
import { OrderService } from '@/lib/services/order-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import {
  setTicketCookie,
  clearTicketCookie,
  getTicketToken,
} from '@/lib/customer-ticket-cookie';
import {
  checkRateLimit,
  RateLimitEndpointClass,
  RateLimitLimit,
  fingerprintQueueToken,
  generateQueueJoinIdentifier,
  getActionClientIp,
} from '@/lib/rate-limit';
import { logger } from '@/lib/logging/logger';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * Phase 3E: Server Actions bypass HTTP-route rate limiters, so abuse
 * protection lives INSIDE each public action. Keys mirror the /api/q/*
 * routes; raw tokens never enter Redis (fingerprints only).
 */
async function limitJoinAttempt(restaurantId: string): Promise<string | null> {
  const result = await checkRateLimit({
    identifier: generateQueueJoinIdentifier(restaurantId, await getActionClientIp()),
    limit: RateLimitLimit.QUEUE_JOIN,
    windowSeconds: 60,
    endpointClass: RateLimitEndpointClass.STATE_CHANGING,
  });
  return result.allowed ? null : 'Too many requests. Please try again shortly.';
}

async function limitTokenAttempt(
  kind: 'cancel' | 'status',
  rawToken: string
): Promise<string | null> {
  let fingerprint: string;
  try {
    fingerprint = fingerprintQueueToken(rawToken);
  } catch {
    return null; // Unfingerprintable input fails closed at validation below.
  }
  const result = await checkRateLimit({
    identifier:
      kind === 'cancel'
        ? `rl:queue:cancel:${fingerprint}`
        : `rl:queue:status:${fingerprint}`,
    limit: kind === 'cancel' ? RateLimitLimit.QUEUE_CANCEL : RateLimitLimit.QUEUE_STATUS,
    windowSeconds: 60,
    endpointClass:
      kind === 'cancel'
        ? RateLimitEndpointClass.STATE_CHANGING
        : RateLimitEndpointClass.TOKEN_AUTHENTICATED,
  });
  return result.allowed ? null : 'Too many requests. Please try again shortly.';
}

export interface JoinQueueState {
  success?: boolean;
  error?: string;
  duplicateToken?: string;
}

export async function joinQueuePublicAction(
  _prevState: JoinQueueState | null,
  formData: FormData
): Promise<JoinQueueState> {
  const restaurantId = formData.get('restaurantId') as string;
  const restaurantSlug = formData.get('restaurantSlug') as string;
  const customerName = (formData.get('customerName') as string || '').trim();
  const customerPhone = (formData.get('customerPhone') as string || '').trim();
  const partySize = parseInt((formData.get('partySize') as string) || '1', 10);
  // Phase 1 Takeaway: read service type from form. Server validates against takeaway_enabled.
  // Defaults to DINE_IN — existing Dine-In flows are unaffected.
  const rawQueueType = (formData.get('queueType') as string) || 'DINE_IN';
  const queueType: 'DINE_IN' | 'TAKEAWAY' = rawQueueType === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN';

  if (!restaurantId || !restaurantSlug) {
    return { error: 'Invalid restaurant context.' };
  }

  if (!customerName) {
    return { error: 'Please enter your name.' };
  }

  // Phase 3E: rate-limit before any DB work (mirrors /api/q/join).
  const joinLimited = await limitJoinAttempt(restaurantId);
  if (joinLimited) {
    return { error: joinLimited };
  }

  try {
    // Phase 3E: the slug-derived restaurant is authoritative for tenant
    // resolution — the client restaurantId must match it.
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== restaurantId) {
      return { error: 'Invalid restaurant context.' };
    }

    const result = await QueueService.joinQueue({
      restaurantId: restaurant.id,
      customerName,
      customerPhone: customerPhone || undefined,
      partySize,
      queueType,
    });

    redirect(`/q/${restaurantSlug}/status/${result.rawToken}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('QUEUE_OUTSIDE_OPERATING_HOURS')) {
      return { error: 'The queue is currently closed. Please check the operating hours and try again later.' };
    }
    if (message.includes('QUEUE_PAUSED')) {
      return { error: 'The queue is temporarily paused. Please check back shortly.' };
    }
    if (message.includes('QUEUE_CLOSED')) {
      return { error: 'The queue for this restaurant is currently closed. Please check back later.' };
    }
    if (message.includes('QUEUE_FULL')) {
      return { error: 'The queue is currently full. Please try again shortly.' };
    }
    if (message.includes('DUPLICATE_ACTIVE_ENTRY')) {
      return {
        error: "You are already waiting in line for this restaurant! Check your existing ticket.",
      };
    }
    if (message.includes('INVALID_PARTY_SIZE')) {
      return { error: 'The selected party size is not accepted by this restaurant.' };
    }
    if (message.includes('TAKEAWAY_DISABLED')) {
      return { error: 'Takeaway is not currently available at this restaurant.' };
    }
    if (message.includes('INVALID_QUEUE_TYPE')) {
      return { error: 'Invalid service type requested.' };
    }

    // Generic fallback — raw service/DB errors must never reach customers.
    logger.warn('Public queue join failed', {
      operation: 'public_queue_join',
      metadata: { error: message },
    });
    return { error: 'Failed to join queue. Please try again.' };
  }
}

export async function cancelQueuePublicAction(token: string, restaurantSlug: string): Promise<void> {
  try {
    // Phase 3E: rate-limit before any DB work (mirrors /api/q/cancel).
    const limited = await limitTokenAttempt('cancel', token);
    if (limited) {
      throw new Error(limited);
    }

    const status = await QueueService.getQueueStatusByToken(token);
    if (!status) {
      throw new Error('Queue entry not found.');
    }

    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== status.restaurantId) {
      throw new Error('Tenant isolation mismatch.');
    }

    await QueueService.updateQueueStatus({
      entryId: status.entryId,
      newStatus: 'CANCELLED',
    });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Failed to cancel queue entry.';
    // Only the friendly rate-limit message passes through; everything else
    // (DB/FSM internals, tenant details) is logged, never surfaced.
    if (message === 'Too many requests. Please try again shortly.') {
      throw new Error(message);
    }
    logger.warn('Public queue cancel failed', {
      operation: 'public_queue_cancel',
      metadata: { error: message },
    });
    throw new Error('Failed to cancel queue entry.');
  }

  redirect(`/q/${restaurantSlug}/status/${token}?cancelled=true`);
}

/**
 * Phase 3D — sync the server-managed HttpOnly ticket cookie after a
 * token-URL visit. The token is validated (hash lookup + tenant match)
 * before anything is persisted; invalid tokens clear stale cookies.
 * Terminal tickets clear the cookie (no lingering bearer state).
 */
export async function syncTicketCookieAction(
  slug: string,
  token: string,
  isTerminal: boolean
): Promise<{ ok: boolean; cleared: boolean }> {
  try {
    if (!slug || !token) return { ok: false, cleared: false };

    if (isTerminal) {
      await clearTicketCookie(slug);
      return { ok: true, cleared: true };
    }

    const status = await QueueService.getQueueStatusByToken(token);
    if (!status) {
      await clearTicketCookie(slug);
      return { ok: false, cleared: true };
    }

    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
    if (!restaurant || restaurant.id !== status.restaurantId) {
      await clearTicketCookie(slug);
      return { ok: false, cleared: true };
    }

    await setTicketCookie(slug, token);
    return { ok: true, cleared: false };
  } catch {
    return { ok: false, cleared: false };
  }
}

export async function delayQueuePublicAction(token: string, restaurantSlug: string): Promise<void> {
  try {
    // Phase 3E: unauthenticated event writes are abuse-sensitive — limit first.
    const limited = await limitTokenAttempt('cancel', token);
    if (limited) {
      throw new Error(limited);
    }

    const status = await QueueService.getQueueStatusByToken(token);
    if (!status) {
      throw new Error('Queue entry not found.');
    }

    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== status.restaurantId) {
      throw new Error('Tenant isolation mismatch.');
    }

    const { createAdminClient } = await import('@/lib/db/supabase/admin');
    const supabase = createAdminClient();

    // Log the event that customer requested a delay
    await supabase.from('queue_events').insert({
      restaurant_id: status.restaurantId,
      queue_entry_id: status.entryId,
      event_type: 'CUSTOMER_DELAY_REQUESTED',
      metadata: { delay_mins: 10 }
    });

  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Failed to request delay.';
    if (message === 'Too many requests. Please try again shortly.') {
      throw new Error(message);
    }
    logger.warn('Public queue delay failed', {
      operation: 'public_queue_delay',
      metadata: { error: message },
    });
    throw new Error('Failed to request delay.');
  }

  redirect(`/q/${restaurantSlug}/status/${token}?delayed=true`);
}

export async function exitDiningCustomerAction(
  token: string,
  restaurantSlug: string,
  destination: 'landing' | 'status' = 'landing'
): Promise<void> {
  try {
    const limited = await limitTokenAttempt('cancel', token);
    if (limited) {
      throw new Error(limited);
    }

    const status = await QueueService.getQueueStatusByToken(token);
    if (!status) {
      throw new Error('Queue entry not found.');
    }

    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
    if (!restaurant || restaurant.id !== status.restaurantId) {
      throw new Error('Tenant isolation mismatch.');
    }

    await QueueService.exitSeatedCustomer(status.entryId);
    await clearTicketCookie(restaurantSlug);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Failed to exit queue flow.';
    if (message === 'Too many requests. Please try again shortly.') {
      throw new Error(message);
    }
    logger.warn('Public queue exit failed', {
      operation: 'public_queue_exit',
      metadata: { error: message },
    });
    throw new Error('Failed to exit dining flow.');
  }

  revalidatePath(`/q/${restaurantSlug}/status/${token}`);
  revalidatePath(`/q/${restaurantSlug}`);
  revalidatePath('/dashboard/tables');
  revalidatePath('/dashboard');

  if (destination === 'landing') {
    redirect(`/q/${restaurantSlug}?left_queue=1`);
  } else {
    redirect(`/q/${restaurantSlug}/status/${token}?exited=true`);
  }
}

export async function quitPreviousQueueAction(restaurantSlug: string): Promise<void> {
  try {
    const raw = await getTicketToken(restaurantSlug);
    if (raw) {
      const status = await QueueService.getQueueStatusByToken(raw);
      if (status) {
        if (status.status === 'SEATED') {
          await QueueService.exitSeatedCustomer(status.entryId);
        } else if (['WAITING', 'NOTIFIED', 'CALLED'].includes(status.status)) {
          await QueueService.updateQueueStatus({
            entryId: status.entryId,
            newStatus: 'CANCELLED',
          });
        }
      }
    }
  } catch {
    // Non-blocking cleanup
  }
  await clearTicketCookie(restaurantSlug);
  revalidatePath(`/q/${restaurantSlug}`);
  revalidatePath('/dashboard/tables');
  revalidatePath('/dashboard');
  redirect(`/q/${restaurantSlug}?new_entry=1`);
}

/**
 * Phase 2 Takeaway: Order-First flow.
 * Atomically joins the Takeaway queue AND creates the linked multi-item order in one action.
 * Sets the HttpOnly ticket cookie and returns tokens for seamless redirection to the Takeaway ticket.
 */
export async function createTakeawayOrderAndQueueAction(input: {
  restaurantId: string;
  restaurantSlug: string;
  customerName: string;
  customerPhone?: string | null;
  items: { menuItemId: string; quantity: number; notes?: string | null }[];
  idempotencyKey?: string | null;
}) {
  const { restaurantId, restaurantSlug, customerName, customerPhone, items, idempotencyKey } = input;

  if (!restaurantId || !restaurantSlug) {
    throw new Error('Invalid restaurant context.');
  }
  const cleanName = (customerName || '').trim();
  if (!cleanName) {
    throw new Error('Please enter your name to place your takeaway order.');
  }
  if (!items || items.length === 0) {
    throw new Error('Please add at least one item to your cart.');
  }

  // Rate limit
  const joinLimited = await limitJoinAttempt(restaurantId);
  if (joinLimited) {
    throw new Error(joinLimited);
  }

  // Authoritative restaurant check
  const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(restaurantSlug);
  if (!restaurant || restaurant.id !== restaurantId) {
    throw new Error('Invalid restaurant context.');
  }
  if (!restaurant.takeawayEnabled) {
    throw new Error('Takeaway ordering is currently disabled for this restaurant.');
  }

  // 1. Atomically join takeaway queue
  const queueResult = await QueueService.joinQueue({
    restaurantId: restaurant.id,
    customerName: cleanName,
    customerPhone: customerPhone ? customerPhone.trim() : undefined,
    partySize: 1,
    queueType: 'TAKEAWAY',
  });

  // 2. Create authoritative order linked to the newly created takeaway queue entry
  const orderResult = await OrderService.createCustomerOrder({
    restaurantId: restaurant.id,
    customerName: cleanName,
    customerPhone: customerPhone ? customerPhone.trim() : undefined,
    queueEntryId: queueResult.entry.id,
    idempotencyKey: idempotencyKey || null,
    items,
  });

  // 3. Set customer ticket cookie so returning to /q/[slug] resumes the ticket
  try {
    await setTicketCookie(restaurantSlug, queueResult.rawToken);
  } catch (err) {
    logger.warn('Failed to set ticket cookie in createTakeawayOrderAndQueueAction', {
      operation: 'createTakeawayOrderAndQueueAction',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  return {
    success: true,
    queueToken: queueResult.rawToken,
    orderToken: orderResult.rawToken,
    queueEntryId: queueResult.entry.id,
    orderId: orderResult.order.id,
  };
}



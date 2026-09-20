import React from 'react';
import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { PublicRestaurantService, PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { QueueService } from '@/lib/services/queue-service';
import { NotificationService } from '@/lib/services/notification-service';
import { QueueTicketCard } from '@/components/customer/QueueTicketCard';
import { TakeawayTicketCard } from '@/components/customer/TakeawayTicketCard';
import { TicketNotificationBanner, type TicketNotification } from '@/components/customer/TicketNotificationBanner';
import { KitchenPreOrderCard } from '@/components/customer/KitchenPreOrderCard';
import { CustomerOrdersCard } from '@/components/customer/CustomerOrdersCard';
import { OrderService } from '@/lib/services/order-service';
import { TicketCookieSync } from '@/components/customer/TicketCookieSync';
import { CustomerQueueRealtime } from '@/components/realtime/CustomerQueueRealtime';
import { CustomerErrorState } from '@/components/customer/CustomerErrorState';
import { shouldShowNotificationBanner } from '@/lib/customer-ticket-ux';
import { logger } from '@/lib/logging/logger';
import { resolveCustomerTheme } from '@/lib/themes';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);

    if (!restaurant) {
      return { title: 'Ticket Not Found — QueueFlow' };
    }

    return {
      title: `Queue Ticket #${restaurant.name} | QueueFlow`,
      description: `Live digital queue status for ${restaurant.name}.`,
    };
  } catch {
    return { title: 'Queue Ticket — QueueFlow' };
  }
}

/**
 * Phase 4B — Customer digital ticket (server-rendered).
 *
 * Identity ALWAYS derives from `hash(rawToken)` → row → actual
 * restaurant/entry (never from client-provided ids). The slug is only
 * cross-checked with a GENERIC 404 — including for tenant mismatches,
 * which must not reveal cross-restaurant information.
 *
 * Position/ETA come from `getQueueStatusByToken` — the same canonical
 * ordering (`joined_at + id` over WAITING/NOTIFIED/CALLED) and the same
 * ETAService config the staff dashboard reads, so both sides stay in
 * sync. Staff mutations broadcast on the narrow entry channel and the
 * ticket revalidates; a 10s visible-tab fallback covers disconnects.
 * A single refresh timer exists (inside the realtime hook) — no doubles.
 */
export default async function CustomerQueueStatusPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;

  // 1. Resolve restaurant by slug
  let restaurant: PublicRestaurantInfo | null = null;
  try {
    restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
  } catch (err) {
    logger.error('Customer queue status page error loading restaurant', {
      operation: 'customer_status_page',
      metadata: { slug, error: err instanceof Error ? err.message : String(err) },
    });
    return (
      <CustomerErrorState
        variant="generic"
        title="Temporarily unavailable"
        body="We're having trouble loading this queue ticket right now. Please try refreshing in a moment."
      />
    );
  }

  if (!restaurant) {
    return (
      <CustomerErrorState
        variant="not-found"
        title="Restaurant not found"
        body={`We couldn't find an active restaurant for "${slug}". Please check the QR code or link and try again.`}
      />
    );
  }

  // 2. Resolve queue status by token (authoritative)
  const status = await QueueService.getQueueStatusByToken(token);
  if (!status) {
    return (
      <CustomerErrorState
        variant="not-found"
        title="Ticket not found"
        body="We couldn't find a valid queue ticket for this link. It may have expired — you can join the queue again."
      />
    );
  }

  // 3. Tenant isolation — generic message (never reveal cross-tenant info).
  if (status.restaurantId !== restaurant.id) {
    return (
      <CustomerErrorState
        variant="not-found"
        title="Ticket not found"
        body="We couldn't find a valid queue ticket for this link. It may have expired — you can join the queue again."
      />
    );
  }

  const isTerminal = QueueService.isTerminalStatus(status.status);

  // Phase 4C/4D: surface ONE relevant persisted notification, deduplicating against
  // authoritative CALLED / SEATED hero messaging to avoid repetitive copy.
  let ticketNotification: TicketNotification | null = null;
  if (!isTerminal) {
    try {
      const rows = await NotificationService.getCustomerNotificationsByQueueId(
        status.entryId,
        status.restaurantId
      );
      const latest = rows?.[0] as unknown as {
        id?: string;
        notification_type?: string;
        message?: string;
        metadata?: { title?: string } | null;
      } | undefined;
      if (latest?.id && latest?.message) {
        const candidate = {
          id: latest.id,
          title:
            latest.metadata?.title ||
            (latest.notification_type || 'Update').replace(/_/g, ' '),
          message: latest.message,
        };
        if (shouldShowNotificationBanner(status.status, candidate)) {
          ticketNotification = candidate;
        }
      }
    } catch {
      ticketNotification = null;
    }
  }

  // Only fetch menu while still queueing (save DB on terminal tickets).
  const menuCategories = !isTerminal ? await PublicRestaurantService.getPublicMenuPreview(restaurant.id) : [];
  // My Orders: every pre-order linked to this queue entry so customers
  // never think their order vanished after navigating back to the ticket.
  let myOrders: Awaited<ReturnType<typeof OrderService.listCustomerOrdersByQueueEntry>> = [];
  try {
    myOrders = await OrderService.listCustomerOrdersByQueueEntry(status.entryId, status.restaurantId);
  } catch {
    myOrders = [];
  }
  const menuUrl = `/q/${slug}/menu?qtoken=${token}`;

  const activeTheme = resolveCustomerTheme(restaurant.customerThemeKey);

  return (
    <CustomerShell theme={activeTheme}>
      {/* Phase 4E: the cookie is retained for active SEATED dining, but cleared
          when dining is completed (status.completedAt) or terminal states (CANCELLED / NO_SHOW / EXPIRED). */}
      <TicketCookieSync slug={slug} token={token} isTerminal={Boolean(status.completedAt) || (isTerminal && status.status !== 'SEATED')} />
      <CustomerQueueRealtime entryId={status.entryId} isTerminal={isTerminal} />

      {/* 1. Official ASSO / QueueFlow Platform Brand */}
      <CustomerPlatformBrand />

      {/* 2. Restaurant Header with Luxury Serif Typography */}
      <header className="text-center pt-1 pb-1 space-y-1.5">
        <h1 className="font-luxury-serif line-clamp-2 break-words text-2xl sm:text-3xl font-normal tracking-[0.06em] uppercase text-[#fff9f0] leading-tight px-2 drop-shadow-[0_2px_14px_rgba(245,158,11,0.20)]">
          {restaurant.name}
        </h1>
        <div className="flex items-center justify-center gap-2.5">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--qf-success)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--qf-success)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--qf-success)]" />
            </span>
            Live Digital Ticket
          </p>
          {!isTerminal && (status.queueType === 'TAKEAWAY' ? (restaurant.takeawayCustomerOrderingEnabled !== false && !restaurant.takeawayManualOrderingEnabled) : restaurant.dineInCustomerOrderingEnabled !== false) && (
            <Link
              href={menuUrl}
              className="inline-flex min-h-[30px] h-7.5 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-xs font-bold text-slate-200 transition-all hover:bg-white/[0.12] hover:text-white active:scale-95 shrink-0"
            >
              <UtensilsCrossed aria-hidden="true" className="h-3 w-3 text-[var(--qf-primary)]" />
              <span>Menu</span>
            </Link>
          )}
        </div>
      </header>

      {/* 3. Hero ticket */}
      <TicketNotificationBanner notification={ticketNotification} />
      {status.queueType === 'TAKEAWAY' ? (
        <TakeawayTicketCard
          status={status}
          token={token}
          restaurantSlug={slug}
          restaurantName={restaurant.name}
          orders={myOrders}
          currency={restaurant.currency || 'INR'}
          takeawayCustomerOrderingEnabled={restaurant.takeawayCustomerOrderingEnabled !== false}
          takeawayManualOrderingEnabled={restaurant.takeawayManualOrderingEnabled}
        />
      ) : (
        <QueueTicketCard
          status={status}
          token={token}
          restaurantSlug={slug}
          restaurantName={restaurant.name}
          queueEnabled={restaurant.queueEnabled}
          operatingState={restaurant.queueOperatingState || 'OPEN'}
        />
      )}

      {!isTerminal && status.queueType !== 'TAKEAWAY' && (
        <div className="space-y-3 pt-1">
          <CustomerOrdersCard
            orders={myOrders}
            restaurantSlug={slug}
            queueToken={token}
          />
          {restaurant.dineInCustomerOrderingEnabled !== false && status.status !== 'CALLED' && (
            <KitchenPreOrderCard
              queueNumber={status.displayNumber || ''}
              restaurantSlug={slug}
              token={token}
              categories={menuCategories}
            />
          )}
        </div>
      )}
    </CustomerShell>
  );
}

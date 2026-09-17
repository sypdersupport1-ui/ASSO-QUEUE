import React from 'react';
import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
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
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);

  if (!restaurant) {
    return { title: 'Ticket Not Found — QueueFlow' };
  }

  return {
    title: `My Queue Ticket — ${restaurant.name} | QueueFlow`,
    description: `View live queue status and position for ${restaurant.name}.`,
  };
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
  const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
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

  return (
    <main className="qf-bg relative flex min-h-[100dvh] flex-col text-slate-100 selection:bg-orange-500/30 selection:text-orange-100">
      {/* Phase 4E: the cookie is retained for active SEATED dining, but cleared
          when dining is completed (status.completedAt) or terminal states (CANCELLED / NO_SHOW / EXPIRED). */}
      <TicketCookieSync slug={slug} token={token} isTerminal={Boolean(status.completedAt) || (isTerminal && status.status !== 'SEATED')} />
      <CustomerQueueRealtime entryId={status.entryId} isTerminal={isTerminal} />

      {/* Warm ambient glows (decorative, vibrant lighting) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-emerald-600/15 via-orange-600/10 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-gradient-to-tr from-cyan-500/10 via-emerald-500/10 to-amber-500/10 blur-3xl" />

      <div className="relative z-10 mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-6 sm:py-8">
        {/* Streamlined Restaurant Header */}
        <header className="flex items-center justify-between gap-3 pt-1 pb-1">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-emerald-500/30 text-emerald-300 text-sm font-black shadow-md shadow-emerald-500/10"
            >
              {restaurant.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-white leading-tight">
                {restaurant.name}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live ticket
              </p>
            </div>
          </div>
          {!isTerminal && (
            <Link
              href={menuUrl}
              className="inline-flex min-h-[40px] h-10 items-center gap-1.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 text-xs font-bold text-emerald-200 transition-all hover:bg-emerald-500/20 active:scale-95 shrink-0 shadow-sm shadow-emerald-500/10"
            >
              <UtensilsCrossed aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" />
              <span>Menu</span>
            </Link>
          )}
        </header>

        {/* Hero ticket */}
        <TicketNotificationBanner notification={ticketNotification} />
        {status.queueType === 'TAKEAWAY' ? (
          <TakeawayTicketCard
            status={status}
            token={token}
            restaurantSlug={slug}
            restaurantName={restaurant.name}
            orders={myOrders}
            currency={restaurant.currency || 'INR'}
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
            {status.status !== 'CALLED' && (
              <KitchenPreOrderCard
                queueNumber={status.displayNumber || ''}
                restaurantSlug={slug}
                token={token}
                categories={menuCategories}
              />
            )}
          </div>
        )}
      </div>

      <footer className="relative z-10 mx-auto w-full max-w-md px-4 pb-6 pt-4 text-center">
        <p className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span>Powered by</span>
          <span className="font-bold tracking-tight text-emerald-400">QueueFlow</span>
        </p>
      </footer>
    </main>
  );
}

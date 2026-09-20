import React from 'react';
import { PublicRestaurantService, PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { CustomerMenuBrowser } from '@/components/customer/CustomerMenuBrowser';
import { CustomerTicketFloat } from '@/components/customer/CustomerTicketFloat';
import { TicketCookieSync } from '@/components/customer/TicketCookieSync';
import { CustomerErrorState } from '@/components/customer/CustomerErrorState';
import { logger } from '@/lib/logging/logger';
import { resolveCustomerTheme } from '@/lib/themes';
import { ThemeArtwork } from '@/components/themes';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);

    if (!restaurant) {
      return { title: 'Menu Not Found — QueueFlow' };
    }

    return {
      title: `Menu — ${restaurant.name} | QueueFlow`,
      description: `Browse menu items and order online for ${restaurant.name}.`,
    };
  } catch {
    return { title: 'Menu — QueueFlow' };
  }
}

export default async function CustomerMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ qtoken?: string; tableId?: string; service?: string }>;
}) {
  const { slug } = await params;
  const { tableId, qtoken, service } = await searchParams;

  let restaurant: PublicRestaurantInfo | null = null;
  try {
    restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
  } catch (err) {
    logger.error('Customer menu page error loading restaurant', {
      operation: 'customer_menu_page',
      metadata: { slug, error: err instanceof Error ? err.message : String(err) },
    });
    return (
      <CustomerErrorState
        variant="generic"
        title="Temporarily unavailable"
        body="We're having trouble loading this menu right now. Please try refreshing in a moment."
      />
    );
  }

  if (!restaurant) {
    return (
      <div className="qf-bg min-h-[100dvh] text-slate-100 flex items-center justify-center p-6">
        <div className="bg-slate-900/90 border border-white/10 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl backdrop-blur-xl">
          <div className="text-4xl">🔍</div>
          <h1 className="text-xl font-bold text-white">Restaurant Not Found</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            We couldn&apos;t find an active menu for &quot;{slug}&quot;.
          </p>
        </div>
      </div>
    );
  }

  // Optional: Resolve queueEntryId if a valid queue token was provided.
  // Phase 4H: also resolve the live queue status so a CALLED customer sees
  // a return-to-restaurant strip instead of browsing cues (server-derived,
  // no second state system).
  let queueEntryId = null;
  let queueStatus: string | null = null;
  let queueType: 'DINE_IN' | 'TAKEAWAY' | null = null;
  if (qtoken) {
    const { QueueService } = await import('@/lib/services/queue-service');
    const status = await QueueService.getQueueStatusByToken(qtoken);
    if (status && status.restaurantId === restaurant.id) {
      queueEntryId = status.entryId;
      queueStatus = status.status;
      queueType = status.queueType || null;
    }
  }

  const isTakeaway = (queueType === 'TAKEAWAY') || (service === 'takeaway' && Boolean(restaurant.takeawayEnabled));
  const serviceType: 'DINE_IN' | 'TAKEAWAY' = isTakeaway ? 'TAKEAWAY' : 'DINE_IN';
  const isOrderingDisabled = isTakeaway
    ? restaurant.takeawayCustomerOrderingEnabled === false
    : restaurant.dineInCustomerOrderingEnabled === false;

  const menuCategories = await PublicRestaurantService.getPublicMenuPreview(restaurant.id);
  const currency = (restaurant as unknown as { currency?: string })?.currency || 'INR';
  const activeTheme = resolveCustomerTheme(restaurant.customerThemeKey);

  return (
    <main className="qf-bg relative flex min-h-[100dvh] flex-col overflow-x-hidden px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-100 sm:py-7">
      {/* Subtle ambient lighting */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-gradient-to-b from-slate-800/20 via-slate-900/10 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-emerald-500/[0.04] blur-3xl" />

      {/* Thematic Decorative Artwork & Motif Layer */}
      <ThemeArtwork theme={activeTheme} variant="page" />

      {qtoken && <TicketCookieSync slug={slug} token={qtoken} isTerminal={false} />}
      <CustomerTicketFloat slug={slug} qtoken={qtoken} />
      <div className="relative z-10 mx-auto w-full max-w-md flex-1 space-y-4 sm:space-y-5">
        <RestaurantHeader restaurant={restaurant} />

        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-black text-white tracking-tight">Food Menu</h1>
            <span className="text-xs font-semibold text-slate-400">
              · {menuCategories.flatMap((c) => c.items).length} items • Live
            </span>
          </div>
          {qtoken ? (
            <a
              href={`/q/${slug}/status/${qtoken}`}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-bold text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <span>My Ticket →</span>
            </a>
          ) : (
            <span className="text-xs font-medium text-slate-400">
              {isTakeaway ? 'Takeaway menu' : 'Dining menu'}
            </span>
          )}
        </div>

        <CustomerMenuBrowser
          categories={menuCategories}
          restaurantId={restaurant.id}
          restaurantSlug={restaurant.slug}
          queueEntryId={queueEntryId}
          tableId={tableId || null}
          currency={currency}
          queueToken={qtoken || null}
          queueStatus={queueStatus}
          serviceType={serviceType}
          orderingDisabled={isOrderingDisabled}
          orderingDisabledReason={
            isTakeaway
              ? 'Takeaway online ordering is currently not active for this restaurant. You can browse the menu and order directly at the counter.'
              : 'Dine-in pre-ordering is currently not active for this restaurant. You can browse the menu and order at your table.'
          }
        />
      </div>

      <footer className="relative z-10 w-full max-w-md mx-auto text-center pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span>Powered by</span>
          <span className="text-emerald-400 font-bold tracking-tight">QueueFlow</span>
        </div>
      </footer>
    </main>
  );
}

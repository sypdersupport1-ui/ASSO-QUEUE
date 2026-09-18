import React from 'react';
import Link from 'next/link';
import { ChevronRight, Phone, UtensilsCrossed, LogOut } from 'lucide-react';
import { PublicRestaurantService, PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { QueueService } from '@/lib/services/queue-service';
import { ETAService } from '@/lib/services/eta-service';
import { QueueScheduleService } from '@/lib/services/queue-schedule-service';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { QueueStatusCard } from '@/components/customer/QueueStatusCard';
import { CustomerJoinFlow } from '@/components/customer/CustomerJoinFlow';
import { MenuPreviewSection } from '@/components/customer/MenuPreviewSection';
import { TicketResumeBanner } from '@/components/customer/TicketResumeBanner';
import { LandingAutoRefresh } from '@/components/customer/LandingAutoRefresh';
import { CustomerErrorState } from '@/components/customer/CustomerErrorState';
import { resolveJoinability, formatWaitLabel } from '@/lib/customer-join-ux';
import { getTicketToken, clearTicketCookie } from '@/lib/customer-ticket-cookie';
import { quitPreviousQueueAction } from '@/app/q/actions';
import { logger } from '@/lib/logging/logger';
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
      return { title: 'Restaurant Not Found — QueueFlow' };
    }

    return {
      title: `${restaurant.name} — Join Digital Queue | QueueFlow`,
      description: `Join the digital waiting line for ${restaurant.name}. Save your spot without standing in line.`,
    };
  } catch {
    return { title: 'QueueFlow — Digital Queue' };
  }
}

/**
 * Phase 4A — Customer QR landing page (server-rendered).
 *
 * Data: restaurant (cached 5 min) + active queue + schedule availability
 * load in parallel; menu preview streams below. All joinability comes
 * from `resolveJoinability` over authoritative backend state — the page
 * never invents its own rules. Join authorization stays server-side in
 * `join_queue_atomic`. ETA uses the restaurant's own tuning via the
 * authoritative `ETAService` formula (no client-side guesswork).
 */
export default async function PublicRestaurantQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ left_queue?: string; new_entry?: string; fresh?: string; service?: string }>;
}) {
  const { slug } = await params;
  const search = searchParams ? await searchParams : {};
  const leftQueueParam = Boolean(search?.left_queue);
  const freshParam = Boolean(search?.new_entry || search?.fresh);
  // null = no service pre-selected (plain QR scan → show ServiceSelector first)
  // Only set when the customer arrives via an explicit ?service= deep link.
  const initialService: 'DINE_IN' | 'TAKEAWAY' | null =
    search?.service === 'takeaway'
      ? 'TAKEAWAY'
      : search?.service === 'dine_in' || search?.service === 'dine-in'
        ? 'DINE_IN'
        : null;

  if (leftQueueParam || freshParam) {
    try {
      await clearTicketCookie(slug);
    } catch {}
  }
  let restaurant: PublicRestaurantInfo | null = null;
  try {
    restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
  } catch (err) {
    logger.error('Public restaurant queue page error loading restaurant', {
      operation: 'public_queue_page',
      metadata: { slug, error: err instanceof Error ? err.message : String(err) },
    });
    return (
      <CustomerErrorState
        variant="generic"
        title="Temporarily unavailable"
        body="We're having trouble loading this restaurant right now. Please try refreshing in a moment."
      />
    );
  }

  if (!restaurant) {
    return (
      <CustomerErrorState
        variant="not-found"
        title="Restaurant not found"
        body={`We couldn't find an active restaurant queue for "${slug}". Please check the QR code or link and try again.`}
      />
    );
  }

  // A transient queue fetch failure degrades (empty counts, join still
  // possible via authoritative RPC) instead of 500ing the customer page.
  let waitingCount = 0;
  let activeQueueCount = 0;
  try {
    const activeEntries = await QueueService.getActiveQueue(restaurant.id);
    waitingCount = activeEntries.filter((e) => e.status === 'WAITING').length;
    activeQueueCount = activeEntries.filter((e) =>
      ['WAITING', 'NOTIFIED', 'CALLED'].includes(e.status)
    ).length;
  } catch (err) {
    logger.warn('Customer queue page: active queue fetch failed, degrading to empty', {
      operation: 'public_queue_page',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  const [menuCategories, availability] = await Promise.all([
    PublicRestaurantService.getPublicMenuPreview(restaurant.id),
    // Effective availability: lifecycle > queue_enabled > manual PAUSED/CLOSED > schedule
    (async () => {
      try {
        return await QueueScheduleService.evaluateAvailability(restaurant.id);
      } catch {
        return null;
      }
    })(),
  ]);

  const isFull = activeQueueCount >= restaurant.maxQueueCapacity;
  const { canJoin, state: landingState } = resolveJoinability({
    queueEnabled: restaurant.queueEnabled,
    operatingState: restaurant.queueOperatingState || 'OPEN',
    isFull,
    scheduledOpen: availability ? availability.scheduledOpen : true,
  });
  const nextOpening = availability?.nextOpening || null;

  // Authoritative ETA: restaurant's own tuning + live queue depth.
  // A newcomer lands behind `waitingCount` parties (position waitingCount+1).
  const eta =
    canJoin && waitingCount > 0
      ? ETAService.calculateETA(waitingCount + 1, {
          avgServiceTimeMins: restaurant.avgServiceTimeMins,
          serviceCapacityUnits: restaurant.serviceCapacityUnits,
          etaBufferMins: restaurant.etaBufferMins,
          almostYourTurnThreshold: 3,
        })
      : null;
  const waitLabel =
    !canJoin || waitingCount === 0 ? null : formatWaitLabel(eta?.estimatedWaitMins);

  // If this browser already holds a live ticket (HttpOnly cookie), don't
  // push the join form again — going "back" to the info page after joining
  // was the top customer complaint. Show resume instead of a duplicate form.
  // Phase 4E: SEATED tickets are retained (cookie survives seating) so the
  // resume copy reflects the current state — waiting, called, or seated.
  // Dead states (CANCELLED / NO_SHOW / EXPIRED) have their cookies cleared
  // on visit and always land on the join form.
  let activeTicketToken: string | null = null;
  type ActiveTicketState = 'WAITING' | 'NOTIFIED' | 'CALLED';
  let activeTicketState: ActiveTicketState = 'WAITING';
  let seatedTicket: { token: string; displayNumber: string | null; customerName: string } | null = null;

  if (!leftQueueParam && !freshParam) {
    try {
      const raw = await getTicketToken(slug);
      if (raw) {
        const s = await QueueService.getQueueStatusByToken(raw);
        if (s && s.restaurantId === restaurant.id && !s.completedAt) {
          if (s.status === 'SEATED') {
            seatedTicket = {
              token: raw,
              displayNumber: s.displayNumber,
              customerName: s.customerName,
            };
          } else if (['WAITING', 'NOTIFIED', 'CALLED'].includes(s.status)) {
            activeTicketToken = raw;
            activeTicketState = s.status as ActiveTicketState;
          }
        } else if (s?.completedAt) {
          await clearTicketCookie(slug);
        }
      }
    } catch {
      activeTicketToken = null;
      seatedTicket = null;
    }
  }

  return (
    <main className="qf-bg relative flex min-h-[100dvh] flex-col justify-between overflow-hidden text-slate-100 selection:bg-orange-500/30 selection:text-orange-100">
      <LandingAutoRefresh />

      <div className="relative z-10 mx-auto w-full max-w-md space-y-4 px-4 py-5 sm:py-7">
        {/* Left queue confirmation banner */}
        {leftQueueParam && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/15 p-4 text-center shadow-lg animate-fadeUp">
            <p className="text-xs font-black text-emerald-300">✨ You have left the queue!</p>
            <p className="mt-1 text-[11px] text-slate-300">Thank you for dining with us. Whenever you return, enter your details below to join again.</p>
          </div>
        )}

        {/* Resume banner (server cookie, only for active waiting/called tickets) */}
        {!leftQueueParam && !freshParam && <TicketResumeBanner slug={slug} />}

        <RestaurantHeader restaurant={restaurant} waitingCount={waitingCount} />

        <QueueStatusCard
          state={landingState}
          waitingCount={waitingCount}
          waitLabel={waitingCount === 0 && canJoin ? 'No wait' : waitLabel}
          nextOpening={nextOpening}
          capacity={{ active: activeQueueCount, max: restaurant.maxQueueCapacity }}
        />

        <div className="animate-fadeUp space-y-4" style={{ animationDelay: '200ms' }}>
        {/* Seated guest banner — allows rejoining while keeping previous ticket accessible */}
        {seatedTicket && (
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-950/40 p-4 shadow-xl backdrop-blur-sm space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <UtensilsCrossed className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 border border-emerald-400/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                  Seated Guest · {seatedTicket.displayNumber ? `Ticket Q-${seatedTicket.displayNumber.replace(/^#+/, '')}` : 'Table Ready'}
                </div>
                <p className="mt-1 text-xs font-bold text-white">
                  Welcome back {seatedTicket.customerName}! Hope you enjoyed your meal 🎉
                </p>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Visiting again today? Fill in the form below to get a new queue ticket, or quit your previous ticket.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Link
                href={`/q/${slug}/status/${seatedTicket.token}`}
                className="flex-1 text-center py-2.5 px-3 rounded-xl border border-white/15 bg-white/5 text-xs font-bold text-slate-200 hover:bg-white/10 active:scale-95 transition-all"
              >
                View Seated Ticket →
              </Link>
              <form action={quitPreviousQueueAction.bind(null, slug)} className="flex-1">
                <button
                  type="submit"
                  className="w-full py-2.5 px-3 rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Quit Previous Ticket</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTicketToken ? (
          <section
            aria-label="Already in queue"
            className="rounded-3xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/20 via-slate-900/90 to-teal-500/10 p-5 text-center shadow-2xl shadow-emerald-500/10"
          >
            <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-emerald-300">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Spot saved
            </p>
            <p className="mt-2 text-base font-black tracking-tight text-white">
              {activeTicketState === 'CALLED'
                ? 'Your turn is being called 📢'
                : "You're already in the queue 🎉"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {activeTicketState === 'CALLED'
                ? 'Please return to the restaurant now — your ticket is live below.'
                : 'No need to fill the form again — your ticket is live below.'}
            </p>
            <Link
              href={`/q/${slug}/status/${activeTicketToken}`}
              className="qf-cta mt-3 flex h-13 min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-sm font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.99]"
            >
              View My Ticket →
            </Link>
            <div className="mt-3 pt-3 border-t border-white/10 flex flex-col items-center gap-2">
              <form action={quitPreviousQueueAction.bind(null, slug)} className="w-full">
                <button
                  type="submit"
                  className="w-full flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Quit Queue & Start New Ticket</span>
                </button>
              </form>
              <p className="text-[10px] text-slate-400">
                Returning for another meal or joining as a different guest? Tap above to start fresh.
              </p>
            </div>
          </section>
        ) : canJoin ? (
          <CustomerJoinFlow restaurant={restaurant} initialService={initialService} />
        ) : (
          <p className="px-2 text-center text-[11px] text-slate-500">
            {landingState === 'FULL'
              ? 'This page updates automatically — no need to refresh.'
              : 'Ask the host if you need help.'}
          </p>
        )}
        </div>

        {/* Contact + secondary menu access (only when data exists) */}
        {(restaurant.phone || restaurant.address) && (
          <section aria-label="Restaurant information" className="qf-card space-y-2 rounded-2xl p-4">
            {restaurant.address && (
              <p className="text-center text-[13px] text-slate-300">
                {restaurant.address}{restaurant.city ? `, ${restaurant.city}` : ''}
              </p>
            )}
            {restaurant.phone && (
              <p className="text-center">
                <a
                  href={`tel:${restaurant.phone.replace(/\s/g, '')}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  <Phone aria-hidden="true" className="h-4 w-4" />
                  {restaurant.phone}
                </a>
              </p>
            )}
          </section>
        )}

        <div className="animate-fadeUp" style={{ animationDelay: '260ms' }}>
          <MenuPreviewSection categories={menuCategories} />
          <Link
            href={`/q/${slug}/menu`}
            className="mt-2 flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 text-[13px] font-bold text-slate-200 transition-all hover:bg-white/10 hover:text-white active:scale-[0.99]"
          >
            🍽️ View full menu
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-emerald-400" />
          </Link>
        </div>
      </div>

      <footer className="relative z-10 mx-auto w-full max-w-md px-4 pb-6 pt-8 text-center">
        <p className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span>Powered by</span>
          <span className="font-bold tracking-tight text-emerald-400">QueueFlow</span>
        </p>
      </footer>
    </main>
  );
}

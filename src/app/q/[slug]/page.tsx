import React from 'react';
import Link from 'next/link';
import { ChevronRight, Phone, UtensilsCrossed, LogOut } from 'lucide-react';
import { PublicRestaurantService, PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { QueueService } from '@/lib/services/queue-service';
import { ETAService } from '@/lib/services/eta-service';
import { QueueScheduleService } from '@/lib/services/queue-schedule-service';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { QueueStatusCard } from '@/components/customer/QueueStatusCard';
import { CustomerJoinFlow } from '@/components/customer/CustomerJoinFlow'; // Hosts QueueJoinForm & TakeawayJoinCard
import { MenuPreviewSection } from '@/components/customer/MenuPreviewSection';
import { TicketResumeBanner } from '@/components/customer/TicketResumeBanner';
import { LandingAutoRefresh } from '@/components/customer/LandingAutoRefresh';
import { CustomerErrorState } from '@/components/customer/CustomerErrorState';
import { resolveJoinability, formatWaitLabel } from '@/lib/customer-join-ux';
import { getTicketToken, clearTicketCookie } from '@/lib/customer-ticket-cookie';
import { quitPreviousQueueAction } from '@/app/q/actions';
import { logger } from '@/lib/logging/logger';
import { resolveCustomerTheme, themeToCssVariables } from '@/lib/themes';
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

  const activeTheme = resolveCustomerTheme(restaurant.customerThemeKey);
  const themeStyles = themeToCssVariables(activeTheme);
  const bgImage = activeTheme.artwork?.backgroundImage ?? null;

  return (
    <main
      className="qf-bg relative flex min-h-[100dvh] flex-col justify-between overflow-x-hidden text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-100"
      data-theme={activeTheme.key}
      style={themeStyles}
    >
      <LandingAutoRefresh />

      {/* ── Theme background image layer ──────────────────────────────────── */}
      {bgImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgImage}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
            className="pointer-events-none fixed inset-0 h-full w-full object-cover object-center select-none"
            style={{ zIndex: 0 }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0"
            style={{
              zIndex: 1,
              background:
                'linear-gradient(to bottom, rgba(20,6,0,0.55) 0%, rgba(20,6,0,0.20) 30%, rgba(20,6,0,0.20) 70%, rgba(20,6,0,0.60) 100%)',
            }}
          />
        </>
      ) : (
        <>
          {/* Subtle ambient lighting (default / non-photo themes) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-gradient-to-b from-slate-800/25 via-slate-900/10 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-emerald-500/[0.04] blur-3xl"
          />
        </>
      )}

      {/* Thematic Decorative Artwork & Motif Layer */}
      <div style={{ zIndex: bgImage ? 2 : undefined, position: bgImage ? 'relative' : undefined }}>
        <ThemeArtwork theme={activeTheme} variant="page" />
      </div>

      <div
        className="relative mx-auto w-full max-w-md space-y-4 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 sm:py-7 flex-1"
        style={{ zIndex: bgImage ? 10 : undefined }}
      >
        {/* Left queue confirmation banner */}
        {leftQueueParam && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center shadow-lg animate-fadeUp">
            <p className="text-xs font-bold text-emerald-300">You have left the queue</p>
            <p className="mt-1 text-[11px] text-slate-300">Thank you for visiting. Whenever you return, choose an option below to join again.</p>
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

        <div className="animate-fadeUp space-y-4" style={{ animationDelay: '150ms' }}>
        {/* Seated guest banner — allows rejoining while keeping previous ticket accessible */}
        {seatedTicket && (
          <div className="rounded-2xl border border-emerald-500/30 bg-[#121826]/95 p-4 shadow-xl backdrop-blur-md space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <UtensilsCrossed className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Seated Guest · {seatedTicket.displayNumber ? `Ticket Q-${seatedTicket.displayNumber.replace(/^#+/, '')}` : 'Table Ready'}
                </div>
                <p className="mt-1 text-xs font-bold text-white">
                  Welcome back {seatedTicket.customerName}! Hope you enjoyed your meal.
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Visiting again today? Fill in the form below to get a new ticket, or release your previous table.
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
            className="rounded-2xl border border-[var(--qf-primary)]/30 bg-[var(--qf-surface-solid)]/95 p-5 text-center shadow-xl backdrop-blur-md"
          >
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-primary)]/30 bg-[var(--qf-primary-glow)] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[var(--qf-primary)]">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--qf-primary)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--qf-primary)]" />
              </span>
              Spot Saved
            </p>
            <p className="mt-2 text-base font-black tracking-tight text-white">
              {activeTicketState === 'CALLED'
                ? 'Your turn is being called'
                : "You're already in the queue"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {activeTicketState === 'CALLED'
                ? 'Please return to the restaurant now — your ticket is live below.'
                : 'No need to fill the form again — your spot is secured.'}
            </p>
            <Link
              href={`/q/${slug}/status/${activeTicketToken}`}
              className="mt-3.5 flex h-12 min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[var(--qf-primary)] hover:bg-[var(--qf-primary-hover)] text-sm font-black text-[var(--qf-primary-foreground)] shadow-lg shadow-black/20 transition-all active:scale-[0.98]"
            >
              View My Ticket →
            </Link>
            <div className="mt-3 pt-3 border-t border-white/10 flex flex-col items-center gap-2">
              <form action={quitPreviousQueueAction.bind(null, slug)} className="w-full">
                <button
                  type="submit"
                  className="w-full flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Quit Queue & Start New Ticket</span>
                </button>
              </form>
              <p className="text-[10px] text-slate-500">
                Returning for another meal or joining as a different guest? Tap above to start fresh.
              </p>
            </div>
          </section>
        ) : canJoin ? (
          <CustomerJoinFlow restaurant={restaurant} initialService={initialService} />
        ) : (
          <p className="px-2 text-center text-xs text-slate-400">
            {landingState === 'FULL'
              ? 'This page updates automatically — no need to refresh.'
              : 'Please check with the host if you require assistance.'}
          </p>
        )}
        </div>

        {/* Contact + location (only when data exists) */}
        {(restaurant.phone || restaurant.address) && (
          <section aria-label="Restaurant information" className="rounded-2xl border border-white/[0.08] bg-[#121826]/80 p-4 space-y-2">
            {restaurant.address && (
              <p className="text-center text-xs text-slate-300">
                {restaurant.address}{restaurant.city ? `, ${restaurant.city}` : ''}
              </p>
            )}
            {restaurant.phone && (
              <p className="text-center">
                <a
                  href={`tel:${restaurant.phone.replace(/\s/g, '')}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--qf-primary)] hover:opacity-80"
                >
                  <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                  {restaurant.phone}
                </a>
              </p>
            )}
          </section>
        )}

        <div className="animate-fadeUp pt-1" style={{ animationDelay: '220ms' }}>
          <MenuPreviewSection categories={menuCategories} />
          <Link
            href={`/q/${slug}/menu`}
            className="mt-2.5 flex min-h-[48px] h-12 items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] text-xs font-bold text-slate-200 transition-all hover:bg-white/[0.08] hover:text-white active:scale-[0.98]"
          >
            <span>View full menu</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--qf-primary)]" />
          </Link>
        </div>
      </div>

      <footer
        className="relative mx-auto w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-center"
        style={{ zIndex: bgImage ? 10 : undefined }}
      >
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span>Powered by</span>
          <span className="font-bold tracking-tight text-[var(--qf-primary)]">QueueFlow</span>
        </p>
      </footer>
    </main>
  );
}

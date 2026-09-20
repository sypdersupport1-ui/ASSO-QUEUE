import React from 'react';
import Link from 'next/link';
import { Phone, UtensilsCrossed, LogOut } from 'lucide-react';
import { PublicRestaurantService, PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { QueueService } from '@/lib/services/queue-service';
import { ETAService } from '@/lib/services/eta-service';
import { QueueScheduleService } from '@/lib/services/queue-schedule-service';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { QueueStatusCard } from '@/components/customer/QueueStatusCard';
import { CustomerJoinFlow } from '@/components/customer/CustomerJoinFlow'; // Hosts QueueJoinForm & TakeawayJoinCard
import { HospitalityFeatureRow } from '@/components/customer/HospitalityFeatureRow';
import { SignatureDishesCard } from '@/components/customer/SignatureDishesCard';
import { TicketResumeBanner } from '@/components/customer/TicketResumeBanner';
import { LandingAutoRefresh } from '@/components/customer/LandingAutoRefresh';
import { CustomerErrorState } from '@/components/customer/CustomerErrorState';
import { resolveJoinability, formatWaitLabel } from '@/lib/customer-join-ux';
import { getTicketToken, clearTicketCookie } from '@/lib/customer-ticket-cookie';
import { quitPreviousQueueAction } from '@/app/q/actions';
import { logger } from '@/lib/logging/logger';
import { resolveCustomerTheme } from '@/lib/themes';
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

  return (
    <CustomerShell theme={activeTheme}>
      <LandingAutoRefresh />

      {/* 1. ASSO / QueueFlow Platform Brand */}
      <CustomerPlatformBrand />

      {/* 2 & 3. Restaurant Name & Optional Tagline */}
      <RestaurantHeader restaurant={restaurant} waitingCount={waitingCount} />

      {/* Left queue confirmation banner */}
      {leftQueueParam && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-center shadow-lg animate-fadeUp">
          <p className="text-xs font-bold text-emerald-300">You have left the queue</p>
          <p className="mt-0.5 text-[11px] text-slate-300">
            Thank you for visiting. Choose an option below whenever you are ready to join again.
          </p>
        </div>
      )}

      {/* Resume banner (server cookie, only for active waiting/called tickets) */}
      {!leftQueueParam && !freshParam && <TicketResumeBanner slug={slug} />}

      {/* 4. Queue / Wait Status Card */}
      <QueueStatusCard
        state={landingState}
        waitingCount={waitingCount}
        waitLabel={waitingCount === 0 && canJoin ? 'No wait' : waitLabel}
        nextOpening={nextOpening}
        capacity={{ active: activeQueueCount, max: restaurant.maxQueueCapacity }}
      />

      {/* Seated guest banner — allows rejoining while keeping previous ticket accessible */}
      {seatedTicket && (
        <div className="rounded-2xl border border-emerald-500/30 bg-[#121826]/95 p-4 shadow-xl backdrop-blur-md space-y-3 animate-fadeUp">
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

      {/* Active Ticket Banner */}
      {activeTicketToken ? (
        <section
          aria-label="Already in queue"
          className="customer-glass-card p-5 text-center space-y-3 animate-fadeUp"
        >
          <p className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-primary)]/30 bg-[var(--qf-primary-glow)] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[var(--qf-primary)]">
            <span aria-hidden="true" className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--qf-primary)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--qf-primary)]" />
            </span>
            Spot Saved
          </p>
          <p className="text-base font-black tracking-tight text-white">
            {activeTicketState === 'CALLED'
              ? 'Your turn is being called'
              : "You're already in the queue"}
          </p>
          <p className="text-xs leading-relaxed text-slate-300">
            {activeTicketState === 'CALLED'
              ? 'Please return to the restaurant now — your ticket is live below.'
              : 'No need to fill the form again — your spot is secured.'}
          </p>
          <Link
            href={`/q/${slug}/status/${activeTicketToken}`}
            className="flex h-12 min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[var(--qf-primary)] hover:bg-[var(--qf-primary-hover)] text-sm font-black text-[var(--qf-primary-foreground)] shadow-lg shadow-black/20 transition-all active:scale-[0.98]"
          >
            View My Ticket →
          </Link>
          <div className="mt-2 pt-2.5 border-t border-white/10 flex flex-col items-center gap-2">
            <form action={quitPreviousQueueAction.bind(null, slug)} className="w-full">
              <button
                type="submit"
                className="w-full flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Quit Queue & Start New Ticket</span>
              </button>
            </form>
          </div>
        </section>
      ) : canJoin ? (
        /* 5, 6, 7, 8. Service Selection ("How would you like to dine?"), Party Size & Join Queue CTA */
        <CustomerJoinFlow restaurant={restaurant} initialService={initialService} />
      ) : (
        <p className="px-2 text-center text-xs text-slate-400 py-2">
          {landingState === 'FULL'
            ? 'This page updates automatically — no need to refresh.'
            : 'Please check with the host if you require assistance.'}
        </p>
      )}

      {/* 9. Hospitality Feature Row */}
      <HospitalityFeatureRow />

      {/* 10. Signature Dishes / Menu Entry */}
      <SignatureDishesCard slug={slug} categories={menuCategories} />

      {/* Contact + location (only when data exists) */}
      {(restaurant.phone || restaurant.address) && (
        <section aria-label="Restaurant information" className="customer-glass-surface p-3.5 sm:p-4 space-y-1 text-center">
          {restaurant.address && (
            <p className="text-xs text-slate-300">
              {restaurant.address}{restaurant.city ? `, ${restaurant.city}` : ''}
            </p>
          )}
          {restaurant.phone && (
            <p>
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
    </CustomerShell>
  );
}

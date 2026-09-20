import Link from 'next/link';
import { getTicketToken } from '@/lib/customer-ticket-cookie';
import { QueueService } from '@/lib/services/queue-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';

/**
 * Phase 3D — server-rendered "active ticket" resume banner.
 *
 * Reads the server-managed HttpOnly ticket cookie (never localStorage,
 * never a JS-readable cookie), validates it (hash lookup + tenant match),
 * and only renders for live (non-terminal) tickets. The token appears in
 * this authorized user's own page link — required for navigation — but is
 * never persisted in browser JS storage, history-independent resume works
 * without it, and Referrer-Policy + no third-party leaks contain it.
 *
 * Phase 4E — the resume copy reflects the CURRENT authoritative state, not
 * the moment the customer joined: a customer returning after being called
 * sees "your turn is being called", after seating sees "you're seated".
 * Dead states (CANCELLED / NO_SHOW / EXPIRED) never resume: their cookies
 * are cleared on visit (see TicketCookieSync), so only the join form shows.
 */

export type ResumeState = 'WAITING' | 'NOTIFIED' | 'CALLED' | 'SEATED';

export function resumeCopyForState(state: ResumeState): { title: string; body: string } {
  switch (state) {
    case 'CALLED':
      return {
        title: 'Your turn is being called',
        body: 'Head back to the restaurant now — tap to view your ticket',
      };
    case 'SEATED':
      return {
        title: "You're seated — enjoy!",
        body: 'Tap to view your ticket and order more',
      };
    case 'NOTIFIED':
      return {
        title: 'Your turn is getting closer',
        body: 'Tap to view your live ticket',
      };
    case 'WAITING':
    default:
      return {
        title: 'You have an active ticket',
        body: 'Tap to view your queue • not lost',
      };
  }
}

/** States eligible for resume. Dead terminals are intentionally excluded. */
export function isResumableTicketStatus(status: string): status is ResumeState {
  return status === 'WAITING' || status === 'NOTIFIED' || status === 'CALLED' || status === 'SEATED';
}

export async function TicketResumeBanner({ slug }: { slug: string }) {
  let token: string | null = null;
  let ticketState: ResumeState = 'WAITING';
  try {
    const raw = await getTicketToken(slug);
    if (raw) {
      const status = await QueueService.getQueueStatusByToken(raw);
      const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
      if (
        status &&
        restaurant &&
        restaurant.id === status.restaurantId &&
        isResumableTicketStatus(status.status)
      ) {
        token = raw;
        ticketState = status.status;
      }
    }
  } catch {
    token = null;
  }

  if (!token) return null;

  const copy = resumeCopyForState(ticketState);
  const highlighted = ticketState === 'CALLED' || ticketState === 'SEATED';

  return (
    <div className="customer-glass-card w-full rounded-2xl border border-[var(--qf-border)] p-4 flex items-center justify-between gap-3 shadow-lg animate-fadeUp">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 rounded-xl bg-[var(--qf-primary)]/15 border border-[var(--qf-primary)]/30 text-[var(--qf-primary)] flex items-center justify-center shrink-0 animate-pulse">
          <span className="material-symbols-outlined text-[20px]">confirmation_number</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-black text-white leading-tight">{copy.title}</div>
          <div className={`text-xs font-medium truncate ${highlighted ? 'text-[var(--qf-warning)]' : 'text-[var(--qf-primary)]'}`}>{copy.body}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/q/${slug}/status/${token}`}
          className="customer-primary-cta px-4 min-h-[44px] h-11 rounded-xl font-black text-sm flex items-center gap-1.5 active:scale-95 transition-all shadow"
        >
          <span className="material-symbols-outlined text-[16px]">visibility</span>
          View
        </Link>
      </div>
    </div>
  );
}

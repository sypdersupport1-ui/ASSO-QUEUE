import React from 'react';
import { Clock, CirclePause, CircleX, Users, Timer } from 'lucide-react';
import type { QueueLandingState } from '@/lib/customer-join-ux';
import { CustomerSurface } from './ui/CustomerSurface';
import { CustomerBadge } from './ui/CustomerBadge';

export interface NextOpeningInfo {
  dayOffset: number;
  dayLabel: string;
  opensAt12h: string;
}

interface QueueStatusCardProps {
  state: QueueLandingState;
  waitingCount: number;
  waitLabel: string | null;
  nextOpening?: NextOpeningInfo | null;
  capacity?: { active: number; max: number };
}

/**
 * Live queue status card.
 * Authoritative presentation of queue availability, party depth, and estimated wait.
 * Clean, professional hospitality presentation without artificial emojis or vibecoding.
 */
export function QueueStatusCard({
  state,
  waitingCount,
  waitLabel,
  nextOpening,
  capacity,
}: QueueStatusCardProps) {
  if (state === 'OPEN' || state === 'CLOSING_SOON') {
    return (
      <CustomerSurface
        aria-label="Live queue status"
        variant="subtle"
        className="flex items-center justify-between gap-3 px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="truncate font-semibold text-slate-200">
            {waitingCount === 0
              ? 'No wait right now'
              : `${waitingCount} ${waitingCount === 1 ? 'party' : 'parties'} waiting in line`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[12px] font-bold text-amber-300 shrink-0">
          <Clock aria-hidden="true" className="h-3.5 w-3.5 text-amber-400" />
          <span>{waitLabel ?? 'Immediate'}</span>
        </div>
      </CustomerSurface>
    );
  }

  if (state === 'FULL') {
    const pct = capacity ? Math.min(100, Math.round((capacity.active / Math.max(1, capacity.max)) * 100)) : 100;
    return (
      <CustomerSurface
        aria-label="Queue status: full"
        variant="card"
        className="text-center p-6 sm:p-7 space-y-3"
      >
        <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <Users className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-black tracking-tight text-white">
            Queue at Full Capacity
          </h2>
          <p className="mx-auto mt-1 max-w-[320px] text-xs leading-relaxed text-slate-400">
            All spots are currently filled. New positions open up as tables are seated — please check back shortly.
          </p>
        </div>
        {capacity && (
          <div className="mx-auto max-w-[260px] pt-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-amber-400">
              {capacity.active} of {capacity.max} spots occupied
            </p>
          </div>
        )}
      </CustomerSurface>
    );
  }

  if (state === 'PAUSED') {
    return (
      <CustomerSurface
        aria-label="Queue status: paused"
        variant="card"
        className="text-center p-6 sm:p-7 space-y-3"
      >
        <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <CirclePause className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-black tracking-tight text-white">
            Queue Temporarily Paused
          </h2>
          <p className="mx-auto mt-1 max-w-[320px] text-xs leading-relaxed text-slate-400">
            The restaurant has briefly paused new entries. Existing guest tickets remain active and honored.
          </p>
        </div>
      </CustomerSurface>
    );
  }

  // CLOSED
  return (
    <CustomerSurface
      aria-label="Queue status: closed"
      variant="card"
      className="text-center p-6 sm:p-7 space-y-3"
    >
      <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
        <CircleX className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-black tracking-tight text-white">
          Queue Currently Closed
        </h2>
        <p className="mx-auto mt-1 max-w-[320px] text-xs leading-relaxed text-slate-400">
          The digital queue is not currently taking new parties.
        </p>
      </div>
      {nextOpening ? (
        <div className="pt-1">
          <CustomerBadge variant="info" icon={<Timer className="h-3.5 w-3.5" />}>
            Opens {nextOpening.dayOffset === 0 ? 'today' : nextOpening.dayLabel} at {nextOpening.opensAt12h}
          </CustomerBadge>
        </div>
      ) : null}
    </CustomerSurface>
  );
}


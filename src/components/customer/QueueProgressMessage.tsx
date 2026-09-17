import React from 'react';
import { BellRing, Footprints } from 'lucide-react';
import {
  classifyProximity,
  proximityCopy,
  type ProximityInput,
} from '@/lib/customer-ticket-ux';

interface QueueProgressMessageProps extends ProximityInput {
  /** Stable key source for assistive tech: announce only on level change. */
  levelKey?: string;
}

/**
 * Phase 4C — Smart queue-progress guidance (presentation only).
 *
 * Renders NOTHING for NORMAL waiting (Phase 4B state block already covers
 * it) and nothing for non-WAITING states (NOTIFIED/CALLED/terminal own
 * their authoritative blocks). Only GETTING_CLOSE and ALMOST_YOUR_TURN
 * produce a compact banner — helpful urgency, never emergency.
 *
 * Pure: no fetches, no timers, no token, no storage. Derived values come
 * from the server-rendered status prop and update only when authoritative
 * refresh delivers new props — so repeated realtime events can never
 * duplicate alerts, sounds, or announcements.
 */
export function QueueProgressMessage(props: QueueProgressMessageProps) {
  const level = classifyProximity(props);

  if (level === null || level === 'NORMAL') return null;

  const copy = proximityCopy(level);
  const Icon = level === 'ALMOST_YOUR_TURN' ? Footprints : BellRing;
  const styles =
    level === 'ALMOST_YOUR_TURN'
      ? 'border-amber-500/30 bg-amber-500/[0.08] text-amber-200'
      : 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-200';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${copy.title}. ${copy.body}`}
      className={`mt-4 flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 ${styles}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-bold leading-tight">{copy.title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">{copy.body}</p>
      </div>
    </div>
  );
}

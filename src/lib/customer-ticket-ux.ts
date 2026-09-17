/**
 * Phase 4B — Customer digital ticket presentation helpers.
 *
 * Pure, dependency-free logic for the ticket screen. No DB access, no
 * secrets, no token handling. Business authorization and state mutation
 * stay in services/actions; position/ETA math stays in ETAService and
 * `QueueService.getQueueStatusByToken` (the single source of truth shared
 * with the staff dashboard — same canonical ordering `joined_at + id`
 * over WAITING/NOTIFIED/CALLED, same ETA config columns).
 *
 * DASHBOARD ⟷ CUSTOMER SYNC CONTRACT (do not break):
 * - Ordering: both sides derive order from (joined_at ASC, id ASC) over
 *   the active set {WAITING, NOTIFIED, CALLED}. Customer `position` is the
 *   count of active entries ahead + 1; dashboard lists in the same order.
 * - ETA: both sides read the same restaurant tuning columns
 *   (avg_service_time_mins, service_capacity_units, eta_buffer_mins)
 *   through ETAService. No second formula may exist in UI code.
 * - Delivery: staff actions broadcast on the narrow
 *   `customer-queue:<entryId>` channel; the ticket revalidates
 *   authoritative server state on every event (payload is only a ping).
 */

import type { QueueStatus } from '@/types/database.types';

export type TicketTone = 'waiting' | 'getting-close' | 'urgent' | 'success' | 'muted';

export interface TicketStateMeta {
  tone: TicketTone;
  /** Screen-reader + visual headline for the state. */
  title: string;
  /** One calm explanatory line. */
  subtitle: string;
  /** Actionable guidance ("do I need to do anything?"). */
  guidance: string;
  /** Whether position / ahead / ETA are meaningful in this state. */
  showWaitInfo: boolean;
  /** Honest funnel stage: 0 Wait · 1 Called · 2 Ready · 3 Seated. */
  stage: 0 | 1 | 2 | 3;
}

const TERMINAL_GENERIC_GUIDANCE = 'This ticket is no longer active.';

export function ticketStateMeta(status: QueueStatus): TicketStateMeta {
  switch (status) {
    case 'WAITING':
      return {
        tone: 'waiting',
        title: "You're in the queue",
        subtitle: 'Your spot is saved. No need to stand in line.',
        guidance: "Hang tight — we'll let you know when your table is getting close.",
        showWaitInfo: true,
        stage: 0,
      };
    case 'NOTIFIED':
      return {
        tone: 'getting-close',
        title: "You're getting close",
        subtitle: 'Your table is being prepared.',
        guidance: 'Please start heading back toward the restaurant.',
        showWaitInfo: true,
        stage: 1,
      };
    case 'CALLED':
      return {
        tone: 'urgent',
        title: 'Your table is being called',
        subtitle: 'Please return to the restaurant now.',
        guidance: 'Head to the host stand — your party is being seated.',
        showWaitInfo: false,
        stage: 2,
      };
    case 'SEATED':
      return {
        tone: 'success',
        title: "You're seated",
        subtitle: 'The wait is over — enjoy your meal.',
        guidance: 'Show this ticket to your server if they ask for it.',
        showWaitInfo: false,
        stage: 3,
      };
    case 'CANCELLED':
      return {
        tone: 'muted',
        title: 'Queue entry cancelled',
        subtitle: 'Your place in the queue is no longer active.',
        guidance: 'You can join the queue again whenever you like.',
        showWaitInfo: false,
        stage: 0,
      };
    case 'NO_SHOW':
      return {
        tone: 'muted',
        title: 'We missed you',
        subtitle: 'Your turn was called but the spot has now expired.',
        guidance: 'Please speak to the host or join the queue again.',
        showWaitInfo: false,
        stage: 0,
      };
    case 'EXPIRED':
      return {
        tone: 'muted',
        title: 'This ticket has expired',
        subtitle: 'This queue ticket is no longer active.',
        guidance: 'Please speak to the host or join the queue again.',
        showWaitInfo: false,
        stage: 0,
      };
    default:
      // Legacy terminal states (COMPLETED / REMOVED / SKIPPED): read-compatible.
      return {
        tone: 'muted',
        title: 'This ticket is no longer active',
        subtitle: TERMINAL_GENERIC_GUIDANCE,
        guidance: 'Please speak to the host if you need help.',
        showWaitInfo: false,
        stage: 3,
      };
  }
}

/**
 * Authoritative display number in customer-friendly form (`Q-128`).
 * Presentation-only: never invents, never exposes DB ids or tokens.
 */
export function formatTicketNumber(
  displayNumber: string | null,
  entryIdFallback: string
): string {
  const raw = (displayNumber || '').trim().replace(/^#+/, '');
  if (raw) return `Q-${raw}`;
  const short = (entryIdFallback || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return short ? `Q-${short}` : 'Q-—';
}

/**
 * Authoritative display number in Takeaway customer-friendly form (`T-08`).
 * Presentation-only: never invents, never exposes DB ids or tokens.
 */
export function formatTakeawayTicketNumber(
  displayNumber: string | null,
  entryIdFallback: string
): string {
  const raw = (displayNumber || '').trim().replace(/^#+/, '').replace(/^[QqTt]-*/i, '');
  if (raw) return `T-${raw}`;
  const short = (entryIdFallback || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return short ? `T-${short}` : 'T-—';
}

/**
 * "Position #7" — or "You're next" at the front — or "Your turn is here" when CALLED.
 * Returns null when waiting metrics should not be shown.
 */
export function positionLabel(position: number | null, status?: QueueStatus): string | null {
  if (status === 'CALLED') return 'Your turn is here';
  if (status === 'SEATED' || (status && isTicketTerminal(status))) return null;
  if (position === null || position <= 0) return null;
  if (position === 1) return "You're next";
  return `Position #${position}`;
}

/** "6 parties ahead" — customer-friendly, no internal counts. */
export function partiesAheadLabel(peopleAhead: number | null): string | null {
  if (peopleAhead === null || peopleAhead < 0) return null;
  if (peopleAhead === 0) return 'No one ahead of you';
  if (peopleAhead === 1) return '1 party ahead';
  return `${peopleAhead} parties ahead`;
}

/**
 * Format customer-safe table assignment string (e.g., "Table 4").
 * Never exposes raw UUIDs or internal identifiers.
 */
export function formatTableNumber(tableNumber: string | null | undefined): string | null {
  if (!tableNumber) return null;
  const cleaned = tableNumber.trim();
  if (!cleaned) return null;
  return cleaned.toLowerCase().startsWith('table') ? cleaned : `Table ${cleaned}`;
}

/**
 * Phase 4E — customer attention levels (presentation ONLY).
 *
 * No new queue states: CALLED is the one real state here; the rest classify
 * how loudly the ticket should present the authoritative WAITING state.
 * The layer never modifies backend state and never invents transitions.
 *
 * Priority (highest first): CALLED > ALMOST_YOUR_TURN > GETTING_CLOSE > NORMAL.
 */
export type AttentionLevel = 'NORMAL' | 'GETTING_CLOSE' | 'ALMOST_YOUR_TURN' | 'CALLED';

export function customerAttentionLevel(
  status: QueueStatus,
  proximity: ProximityLevel | null
): AttentionLevel {
  if (status === 'CALLED') return 'CALLED';
  if (status !== 'WAITING') return 'NORMAL';
  if (proximity === 'ALMOST_YOUR_TURN') return 'ALMOST_YOUR_TURN';
  if (proximity === 'GETTING_CLOSE') return 'GETTING_CLOSE';
  return 'NORMAL';
}

/**
 * Phase 4D: Notification banner deduplication.
 * Prevents duplicate banners when the ticket's primary state already presents
 * the authoritative message (e.g. CALLED or SEATED).
 *
 * Phase 4E extension: a stale "your table is ready / called" notification
 * must never resurface as primary content once the ticket has moved to ANY
 * terminal state (SEATED, NO_SHOW, CANCELLED, EXPIRED). The hero owns the
 * truth; the banner may only carry genuinely different secondary context.
 */
export function isCalledNotification(notification: { title?: string; message?: string }): boolean {
  const text = `${notification.title || ''} ${notification.message || ''}`.toLowerCase();
  return (
    text.includes('table is being called') ||
    text.includes('table is ready') ||
    text.includes('return to the restaurant') ||
    text.includes('come to the host stand') ||
    text.includes('your turn') ||
    text.includes('called')
  );
}

export function shouldShowNotificationBanner(
  status: QueueStatus,
  notification: { title?: string; message?: string } | null
): boolean {
  if (!notification || !notification.message) return false;
  if (status === 'SEATED') return false;

  if (status === 'CALLED') {
    // Suppress if the notification message duplicates the "table called / return to restaurant" message
    if (isCalledNotification(notification)) {
      return false;
    }
  }

  // Phase 4E: terminal states own their hero; a leftover CALLED-type
  // notification would read as "you are being called right now" even when
  // the customer returns minutes later to a NO_SHOW / CANCELLED / EXPIRED
  // ticket. Non-called notifications (different useful info) may still show
  // as secondary context.
  if (isTicketTerminal(status) && isCalledNotification(notification)) {
    return false;
  }

  return true;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'SEATED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
  'COMPLETED',
  'REMOVED',
  'SKIPPED',
]);

export function isTicketTerminal(status: QueueStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * A paused/closed queue NEVER cancels an existing ticket. Returns a subtle
 * note for active tickets when new entries are unavailable, else null.
 */
export function operatingNoteForTicket(
  status: QueueStatus,
  queueEnabled: boolean,
  operatingState: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED'
): string | null {
  if (isTicketTerminal(status)) return null;
  if (!queueEnabled || operatingState === 'CLOSED') {
    return 'Your ticket is still active. The restaurant is not taking new entries right now.';
  }
  if (operatingState === 'PAUSED') {
    return 'Your ticket is still active. New entries are temporarily paused.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 4C — "Almost your turn" proximity classification.
//
// PRESENTATION-ONLY UX CLASSIFICATION. This is NOT a queue state, never
// touches the FSM, and can never alter backend behavior. It only selects
// guidance copy/emphasis on top of the authoritative WAITING state.
//
// EXACT RULE (deterministic, single-signal):
//   inputs : status, peopleAhead, isAlmostYourTurn — all authoritative,
//            from `getQueueStatusByToken` (same source as the dashboard).
//   - status !== 'WAITING'          → null (backend state owns NOTIFIED /
//                                      CALLED / terminal presentation)
//   - peopleAhead <= 1              → 'ALMOST_YOUR_TURN'
//   - isAlmostYourTurn === true     → 'GETTING_CLOSE'
//                                      (authoritative flag: peopleAhead <=
//                                      restaurant almost_your_turn_threshold,
//                                      staff-configurable, default 3)
//   - otherwise (incl. unknowns)    → 'NORMAL' (fail calm, never urgent)
//
// ETA deliberately does NOT drive urgency: it is an estimate, and using
// it for urgency would manufacture false precision.
//
// PRECEDENCE (backend state always wins):
//   TERMINAL > CALLED > NOTIFIED > ALMOST_YOUR_TURN > GETTING_CLOSE > NORMAL
// ---------------------------------------------------------------------------

export type ProximityLevel = 'NORMAL' | 'GETTING_CLOSE' | 'ALMOST_YOUR_TURN';

export interface ProximityInput {
  status: QueueStatus;
  peopleAhead: number | null;
  isAlmostYourTurn: boolean;
}

export function classifyProximity(input: ProximityInput): ProximityLevel | null {
  if (input.status !== 'WAITING') return null;
  if (input.peopleAhead !== null && input.peopleAhead <= 1) {
    return 'ALMOST_YOUR_TURN';
  }
  if (input.isAlmostYourTurn) {
    return 'GETTING_CLOSE';
  }
  return 'NORMAL';
}

export interface ProximityCopy {
  title: string;
  body: string;
}

/**
 * Calm, preparation-framed copy. Never "come now" — only CALLED (a real
 * staff action) may demand return. Never a countdown, never a percentage.
 */
export function proximityCopy(level: ProximityLevel): ProximityCopy {
  switch (level) {
    case 'ALMOST_YOUR_TURN':
      return {
        title: 'Almost your turn',
        body: "Please stay nearby so you don't miss your table.",
      };
    case 'GETTING_CLOSE':
      return {
        title: "You're getting close",
        body: 'Keep an eye on your phone — your table is getting nearer.',
      };
    case 'NORMAL':
      return {
        title: "You're in the queue",
        body: "Hang tight — we'll keep you updated.",
      };
  }
}

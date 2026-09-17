/**
 * Phase 4A — Customer QR landing & join UX helpers.
 *
 * Pure, dependency-free presentation logic for the anonymous customer
 * QR landing page. No DB access, no secrets, no token handling here.
 *
 * SECURITY NOTES (must stay true):
 * - Phone normalization for SUBMIT is trim-only. The authoritative
 *   duplicate-phone check (`join_queue_atomic`) compares the exact
 *   trimmed string, so any client-side reformatting (stripping +91,
 *   removing spaces) would BYPASS duplicate protection. Never change
 *   `normalizePhoneForSubmit` to reformat digits.
 * - Client validation mirrors the server contract but NEVER replaces it.
 *   `JoinQueueSchema` + the atomic RPC remain authoritative.
 */

export type QueueLandingState =
  | 'OPEN'
  | 'CLOSING_SOON'
  | 'PAUSED'
  | 'CLOSED'
  | 'FULL';

export interface JoinabilityInput {
  queueEnabled: boolean;
  operatingState: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
  isFull: boolean;
  scheduledOpen: boolean;
}

export interface Joinability {
  canJoin: boolean;
  state: QueueLandingState;
}

/**
 * Single source of truth for landing-page joinability presentation.
 * Precedence mirrors the backend: queue_enabled > manual PAUSED/CLOSED >
 * scheduled hours > FULL > OPEN/CLOSING_SOON allow.
 */
export function resolveJoinability(input: JoinabilityInput): Joinability {
  const { queueEnabled, operatingState, isFull, scheduledOpen } = input;

  if (!queueEnabled || operatingState === 'CLOSED' || !scheduledOpen) {
    return { canJoin: false, state: 'CLOSED' };
  }
  if (operatingState === 'PAUSED') {
    return { canJoin: false, state: 'PAUSED' };
  }
  if (isFull) {
    return { canJoin: false, state: 'FULL' };
  }
  if (operatingState === 'CLOSING_SOON') {
    return { canJoin: true, state: 'CLOSING_SOON' };
  }
  return { canJoin: true, state: 'OPEN' };
}

/**
 * Formats an authoritative wait estimate. Never invents precision:
 * - `null`/non-finite → graceful fallback (never "0 min").
 * - >= 20 min rounds to the nearest 5 ("~35 min", not "34 min").
 * - >= 60 min renders hours ("~1 hr 10 min").
 */
export function formatWaitLabel(waitMins: number | null | undefined): string {
  if (waitMins === null || waitMins === undefined || !Number.isFinite(waitMins)) {
    return 'Wait time updating';
  }
  const mins = Math.max(1, Math.round(waitMins));
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rest = mins % 60;
    if (rest === 0) return `~${hrs} hr`;
    return `~${hrs} hr ${rest} min`;
  }
  if (mins >= 20) {
    return `~${Math.round(mins / 5) * 5} min`;
  }
  return `~${mins} min`;
}

export interface JoinFormValues {
  name: string;
  phone: string;
  partySize: number;
}

export interface JoinFormConstraints {
  minParty: number;
  maxParty: number;
}

export interface JoinFormErrors {
  name?: string;
  phone?: string;
  partySize?: string;
}

/**
 * Lenient phone check: optional field; when provided must look like a
 * real phone number (7–15 digits, allowing +, spaces, dashes, brackets).
 * Accepts Indian 10-digit mobiles with or without +91 — never rejects
 * legitimate formats client-side; the server remains authoritative.
 */
export function isPlausiblePhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!/^[+\d][\d\s\-().]{5,}[0-9)]$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Client-side mirror of the backend join contract for instant UX.
 * Returns per-field messages; empty object = valid.
 */
export function validateJoinForm(
  values: JoinFormValues,
  constraints: JoinFormConstraints
): JoinFormErrors {
  const errors: JoinFormErrors = {};
  const name = values.name.trim();

  if (!name) {
    errors.name = 'Please enter your name.';
  } else if (name.length > 100) {
    errors.name = 'Name is too long — please use under 100 characters.';
  }

  const phone = values.phone.trim();
  if (phone && !isPlausiblePhone(phone)) {
    errors.phone = 'Please enter a valid phone number.';
  }

  const { minParty, maxParty } = constraints;
  if (!Number.isInteger(values.partySize) || values.partySize < minParty || values.partySize > maxParty) {
    errors.partySize =
      minParty === maxParty
        ? `Party size must be ${minParty}.`
        : `Party size must be between ${minParty} and ${maxParty}.`;
  }

  return errors;
}

/**
 * Submit normalization: TRIM ONLY (see module docblock — reformatting
 * would bypass the exact-match duplicate-phone guard in the RPC).
 */
export function normalizePhoneForSubmit(phone: string): string {
  return phone.trim();
}

export type JoinErrorKind =
  | 'CLOSED'
  | 'PAUSED'
  | 'FULL'
  | 'DUPLICATE_ACTIVE_PHONE'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'GENERIC_SERVER_ERROR';

export interface JoinErrorUX {
  kind: JoinErrorKind;
  title: string;
  body: string;
  retryable: boolean;
}

/**
 * Maps the (already friendly) server-action error strings to the
 * polished error-state UX matrix. Unknown messages fall back to a
 * generic, non-technical error — raw DB/RPC text never reaches the UI
 * because the action layer already strips it; this is belt-and-braces.
 */
export function mapJoinErrorToUX(message: string): JoinErrorUX {
  const m = (message || '').toLowerCase();

  if (m.includes('too many requests')) {
    return {
      kind: 'RATE_LIMITED',
      title: 'Please wait a moment',
      body: 'Too many requests. Try again in a moment.',
      retryable: true,
    };
  }
  if (m.includes('already waiting') || m.includes('duplicate')) {
    return {
      kind: 'DUPLICATE_ACTIVE_PHONE',
      title: "You're already in line",
      body: 'This number already has an active ticket here. Please use your existing ticket or ask the host for help.',
      retryable: false,
    };
  }
  if (m.includes('full') || m.includes('capacity')) {
    return {
      kind: 'FULL',
      title: 'Queue is full',
      body: 'The restaurant has reached its current queue capacity. Please check again shortly — spots open as guests are seated.',
      retryable: true,
    };
  }
  if (m.includes('paused') || m.includes('temporarily')) {
    return {
      kind: 'PAUSED',
      title: 'Queue temporarily paused',
      body: 'The restaurant has temporarily paused new entries. Existing tickets are still active — please check back shortly.',
      retryable: true,
    };
  }
  if (
    m.includes('closed') ||
    m.includes('operating hours') ||
    m.includes('operating_hours') ||
    m.includes('not accepting') ||
    m.includes('not available')
  ) {
    return {
      kind: 'CLOSED',
      title: 'Queue currently closed',
      body: 'The restaurant is not accepting new queue entries right now. Please check back later or ask the host.',
      retryable: true,
    };
  }
  if (m.includes('party size') || m.includes('name') || m.includes('phone') || m.includes('invalid')) {
    return {
      kind: 'VALIDATION_ERROR',
      title: 'Check your details',
      body: message,
      retryable: true,
    };
  }
  return {
    kind: 'GENERIC_SERVER_ERROR',
    title: 'Something went wrong',
    body: 'We could not join the queue right now. Please check your connection and try again.',
    retryable: true,
  };
}

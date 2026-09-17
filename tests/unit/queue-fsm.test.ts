/**
 * tests/unit/queue-fsm.test.ts
 *
 * Tests for the Queue Entry FSM:
 *   - Authoritative active states: WAITING, CALLED, NOTIFIED
 *   - Authoritative terminal states: SEATED, CANCELLED, NO_SHOW, EXPIRED
 *   - Legacy states (historical only): COMPLETED, REMOVED, SKIPPED
 *   - Fully deprecated: CONFIRMED, ARRIVED (must NOT appear in code)
 *   - Seatable states: WAITING, CALLED, NOTIFIED
 */

import { describe, it, expect } from 'vitest';
import type {
  QueueStatus,
  ActiveQueueStatus,
  TerminalQueueStatus,
  SeatableQueueStatus,
} from '@/types/database.types';

// ---------------------------------------------------------------------------
// Inline FSM helpers (derived from authoritative definition in implementation_plan.md)
// These mirror what the DB seat_queue_entry_atomic() function enforces.
// ---------------------------------------------------------------------------

const ACTIVE_STATES: ActiveQueueStatus[] = ['WAITING', 'CALLED', 'NOTIFIED'];
const TERMINAL_STATES: TerminalQueueStatus[] = [
  'SEATED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
  'COMPLETED',  // legacy historical
  'REMOVED',    // legacy historical
  'SKIPPED',    // legacy historical
];
const SEATABLE_STATES: SeatableQueueStatus[] = ['WAITING', 'CALLED', 'NOTIFIED'];

// All deprecated states should NOT appear as valid new-record states
const DEPRECATED_STATES = ['CONFIRMED', 'ARRIVED'];

function canSeat(status: QueueStatus): boolean {
  return (SEATABLE_STATES as string[]).includes(status);
}

function isTerminal(status: QueueStatus): boolean {
  return (TERMINAL_STATES as string[]).includes(status);
}

function isActive(status: QueueStatus): boolean {
  return (ACTIVE_STATES as string[]).includes(status);
}

// Valid FSM transitions (application-level model)
const VALID_TRANSITIONS: Partial<Record<QueueStatus, QueueStatus[]>> = {
  WAITING:  ['NOTIFIED', 'CALLED', 'CANCELLED', 'EXPIRED'],
  NOTIFIED: ['CALLED', 'SEATED', 'CANCELLED', 'EXPIRED'],
  CALLED:   ['SEATED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'],
};

function canTransition(from: QueueStatus, to: QueueStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue FSM — State Classification', () => {
  it('WAITING is active and seatable', () => {
    expect(isActive('WAITING')).toBe(true);
    expect(canSeat('WAITING')).toBe(true);
    expect(isTerminal('WAITING')).toBe(false);
  });

  it('CALLED is active and seatable', () => {
    expect(isActive('CALLED')).toBe(true);
    expect(canSeat('CALLED')).toBe(true);
    expect(isTerminal('CALLED')).toBe(false);
  });

  it('NOTIFIED is active and seatable', () => {
    expect(isActive('NOTIFIED')).toBe(true);
    expect(canSeat('NOTIFIED')).toBe(true);
    expect(isTerminal('NOTIFIED')).toBe(false);
  });

  it('SEATED is terminal and not seatable', () => {
    expect(isTerminal('SEATED')).toBe(true);
    expect(canSeat('SEATED')).toBe(false);
    expect(isActive('SEATED')).toBe(false);
  });

  it('CANCELLED is terminal and not seatable', () => {
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(canSeat('CANCELLED')).toBe(false);
  });

  it('NO_SHOW is terminal and not seatable', () => {
    expect(isTerminal('NO_SHOW')).toBe(true);
    expect(canSeat('NO_SHOW')).toBe(false);
  });

  it('EXPIRED is terminal and not seatable', () => {
    expect(isTerminal('EXPIRED')).toBe(true);
    expect(canSeat('EXPIRED')).toBe(false);
  });

  it('COMPLETED (legacy) is terminal and not seatable', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(canSeat('COMPLETED')).toBe(false);
  });

  it('REMOVED (legacy) is terminal and not seatable', () => {
    expect(isTerminal('REMOVED')).toBe(true);
    expect(canSeat('REMOVED')).toBe(false);
  });

  it('SKIPPED (legacy) is terminal and not seatable', () => {
    expect(isTerminal('SKIPPED')).toBe(true);
    expect(canSeat('SKIPPED')).toBe(false);
  });
});

describe('Queue FSM — Valid Transitions', () => {
  it('WAITING → NOTIFIED (customer notified)', () => {
    expect(canTransition('WAITING', 'NOTIFIED')).toBe(true);
  });

  it('WAITING → CALLED (called to seat)', () => {
    expect(canTransition('WAITING', 'CALLED')).toBe(true);
  });

  it('WAITING → CANCELLED', () => {
    expect(canTransition('WAITING', 'CANCELLED')).toBe(true);
  });

  it('WAITING → EXPIRED', () => {
    expect(canTransition('WAITING', 'EXPIRED')).toBe(true);
  });

  it('NOTIFIED → CALLED', () => {
    expect(canTransition('NOTIFIED', 'CALLED')).toBe(true);
  });

  it('NOTIFIED → SEATED', () => {
    expect(canTransition('NOTIFIED', 'SEATED')).toBe(true);
  });

  it('CALLED → SEATED (happy path)', () => {
    expect(canTransition('CALLED', 'SEATED')).toBe(true);
  });

  it('CALLED → NO_SHOW', () => {
    expect(canTransition('CALLED', 'NO_SHOW')).toBe(true);
  });
});

describe('Queue FSM — Invalid Transitions', () => {
  it('SEATED cannot transition to any state (terminal)', () => {
    const allTargets: QueueStatus[] = [
      'WAITING', 'CALLED', 'NOTIFIED', 'CANCELLED', 'EXPIRED', 'NO_SHOW',
    ];
    for (const target of allTargets) {
      expect(canTransition('SEATED', target)).toBe(false);
    }
  });

  it('CANCELLED cannot transition (terminal)', () => {
    expect(canTransition('CANCELLED', 'WAITING')).toBe(false);
  });

  it('WAITING → SEATED is not a direct transition (must go via CALLED)', () => {
    expect(canTransition('WAITING', 'SEATED')).toBe(false);
  });

  it('WAITING → NO_SHOW is not valid', () => {
    expect(canTransition('WAITING', 'NO_SHOW')).toBe(false);
  });
});

describe('Queue FSM — Deprecated States', () => {
  it('CONFIRMED and ARRIVED are not in QueueStatus (fully removed from TS)', () => {
    // These should NOT be assignable to QueueStatus.
    // We validate the runtime model doesn't include them in active/terminal/seatable arrays.
    for (const deprecated of DEPRECATED_STATES) {
      expect(ACTIVE_STATES.map(String)).not.toContain(deprecated);
      expect(TERMINAL_STATES.map(String)).not.toContain(deprecated);
      expect(SEATABLE_STATES.map(String)).not.toContain(deprecated);
    }
  });
});

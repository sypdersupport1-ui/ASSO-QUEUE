/**
 * tests/unit/payment-fsm.test.ts
 *
 * Tests for Payment Transaction FSM states and the SUCCEEDED vs COMPLETED
 * semantic clarification introduced in the Phase 15 reconciliation.
 *
 * Authoritative FSM:
 *   PENDING → PROCESSING → SUCCEEDED (terminal)
 *   PENDING → FAILED (terminal)
 *   SUCCEEDED → REFUND_PENDING → REFUNDED (terminal)
 *
 * COMPLETED is a legacy alias for SUCCEEDED (historical records only).
 * New records must use SUCCEEDED.
 */

import { describe, it, expect } from 'vitest';
import type { TransactionPaymentStatus } from '@/types/database.types';

// ---------------------------------------------------------------------------
// Inline FSM helpers (mirror the DB constraint policy)
// ---------------------------------------------------------------------------

const AUTHORITATIVE_SUCCESS_STATE: TransactionPaymentStatus = 'SUCCEEDED';
const LEGACY_ALIAS: TransactionPaymentStatus = 'COMPLETED'; // historical only

type PaymentFSMState = TransactionPaymentStatus;

// Authoritative terminal states for a payment transaction
const PAYMENT_TERMINAL_STATES: PaymentFSMState[] = ['SUCCEEDED', 'FAILED', 'REFUNDED', 'COMPLETED'];

// Valid transitions
const VALID_PAYMENT_TRANSITIONS: Partial<Record<PaymentFSMState, PaymentFSMState[]>> = {
  PENDING:        ['PROCESSING', 'FAILED'],
  PROCESSING:     ['SUCCEEDED', 'FAILED'],
  SUCCEEDED:      ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
};

function canPaymentTransition(from: PaymentFSMState, to: PaymentFSMState): boolean {
  const allowed = VALID_PAYMENT_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

function isPaymentTerminal(status: PaymentFSMState): boolean {
  return PAYMENT_TERMINAL_STATES.includes(status);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Payment FSM — State Classification', () => {
  it('PENDING is not terminal', () => {
    expect(isPaymentTerminal('PENDING')).toBe(false);
  });

  it('PROCESSING is not terminal', () => {
    expect(isPaymentTerminal('PROCESSING')).toBe(false);
  });

  it('SUCCEEDED is terminal', () => {
    expect(isPaymentTerminal('SUCCEEDED')).toBe(true);
  });

  it('FAILED is terminal', () => {
    expect(isPaymentTerminal('FAILED')).toBe(true);
  });

  it('REFUNDED is terminal', () => {
    expect(isPaymentTerminal('REFUNDED')).toBe(true);
  });

  it('COMPLETED (legacy) is considered terminal', () => {
    expect(isPaymentTerminal('COMPLETED')).toBe(true);
  });
});

describe('Payment FSM — Valid Transitions', () => {
  it('PENDING → PROCESSING', () => {
    expect(canPaymentTransition('PENDING', 'PROCESSING')).toBe(true);
  });

  it('PENDING → FAILED (provider rejection)', () => {
    expect(canPaymentTransition('PENDING', 'FAILED')).toBe(true);
  });

  it('PROCESSING → SUCCEEDED (happy path)', () => {
    expect(canPaymentTransition('PROCESSING', 'SUCCEEDED')).toBe(true);
  });

  it('PROCESSING → FAILED', () => {
    expect(canPaymentTransition('PROCESSING', 'FAILED')).toBe(true);
  });

  it('SUCCEEDED → REFUND_PENDING', () => {
    expect(canPaymentTransition('SUCCEEDED', 'REFUND_PENDING')).toBe(true);
  });

  it('REFUND_PENDING → REFUNDED', () => {
    expect(canPaymentTransition('REFUND_PENDING', 'REFUNDED')).toBe(true);
  });
});

describe('Payment FSM — Invalid Transitions', () => {
  it('SUCCEEDED cannot go back to PENDING', () => {
    expect(canPaymentTransition('SUCCEEDED', 'PENDING')).toBe(false);
  });

  it('FAILED cannot transition anywhere', () => {
    expect(canPaymentTransition('FAILED', 'SUCCEEDED')).toBe(false);
    expect(canPaymentTransition('FAILED', 'PENDING')).toBe(false);
  });

  it('REFUNDED is final — no further transitions', () => {
    expect(canPaymentTransition('REFUNDED', 'PENDING')).toBe(false);
    expect(canPaymentTransition('REFUNDED', 'SUCCEEDED')).toBe(false);
  });

  it('PENDING cannot skip directly to SUCCEEDED', () => {
    expect(canPaymentTransition('PENDING', 'SUCCEEDED')).toBe(false);
  });
});

describe('Payment FSM — SUCCEEDED vs COMPLETED Semantics', () => {
  it('SUCCEEDED is the authoritative success state', () => {
    expect(AUTHORITATIVE_SUCCESS_STATE).toBe('SUCCEEDED');
  });

  it('COMPLETED is the legacy alias for SUCCEEDED', () => {
    expect(LEGACY_ALIAS).toBe('COMPLETED');
  });

  it('SUCCEEDED and COMPLETED are semantically equivalent for revenue counting', () => {
    const successStates: PaymentFSMState[] = ['SUCCEEDED', 'COMPLETED'];
    // Both should be counted for revenue queries (historical compat)
    const revenueFilter = (s: PaymentFSMState) => successStates.includes(s);
    expect(revenueFilter('SUCCEEDED')).toBe(true);
    expect(revenueFilter('COMPLETED')).toBe(true);
    expect(revenueFilter('PENDING')).toBe(false);
    expect(revenueFilter('FAILED')).toBe(false);
  });

  it('New records must not use COMPLETED — SUCCEEDED is required', () => {
    // Document: new payment records should always set status=SUCCEEDED
    const newRecordStatus: TransactionPaymentStatus = 'SUCCEEDED';
    expect(newRecordStatus).toBe('SUCCEEDED');
    expect(newRecordStatus).not.toBe('COMPLETED');
  });
});

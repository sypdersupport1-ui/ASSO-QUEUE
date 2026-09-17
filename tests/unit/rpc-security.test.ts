/**
 * tests/unit/rpc-security.test.ts
 *
 * Documents and validates the EXECUTE privilege policy for all SECURITY DEFINER
 * RPCs introduced or modified in Phase 15 reconciliation.
 *
 * These are policy-validation tests — they assert the expected access model
 * for each function. Actual DB-level enforcement is tested by the integration
 * RLS suite in tests/db/rls-tenant-isolation.test.ts.
 *
 * Privilege Policy (enforced by 20260912000011_phase15_reconciliation.sql):
 *
 *   Function                      | anon | authenticated | service_role
 *   ------------------------------|------|---------------|-------------
 *   claim_outbox_events           |  ✗   |      ✗        |      ✓
 *   recover_stale_outbox_events   |  ✗   |      ✗        |      ✓
 *   deduct_inventory_atomic       |  ✗   |      ✗        |      ✓
 *   seat_queue_entry_atomic       |  ✗   |      ✓ *      |      ✓
 *   join_queue_atomic             |  ✓   |      ✓        |      ✓
 *   get_queue_metrics_summary     |  ✗   |      ✓ **     |      ✓
 *   get_hourly_queue_volume       |  ✗   |      ✓ **     |      ✓
 *   get_commerce_metrics_summary  |  ✗   |      ✓ **     |      ✓
 *
 *   * seat_queue_entry_atomic: authenticated users may call, but the function
 *     internally enforces has_permission(queue.seat) — unauthorized users are
 *     rejected even if they call the function.
 *
 *   ** analytics RPCs: authenticated users may call, but the function
 *      internally enforces restaurant membership — non-members are rejected.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Policy definitions — single source of truth for this test suite
// ---------------------------------------------------------------------------

type Role = 'anon' | 'authenticated' | 'service_role';

interface RPCPolicy {
  name: string;
  allowedRoles: Role[];
  internalAuthCheck: boolean;
  callerType: 'public' | 'privileged' | 'internal';
  description: string;
}

const RPC_POLICIES: RPCPolicy[] = [
  {
    name: 'claim_outbox_events',
    allowedRoles: ['service_role'],
    internalAuthCheck: false,
    callerType: 'internal',
    description: 'Background outbox worker — service_role only',
  },
  {
    name: 'recover_stale_outbox_events',
    allowedRoles: ['service_role'],
    internalAuthCheck: false,
    callerType: 'internal',
    description: 'Stale event recovery cron — service_role only',
  },
  {
    name: 'deduct_inventory_atomic',
    allowedRoles: ['service_role'],
    internalAuthCheck: false,
    callerType: 'internal',
    description: 'Order inventory deduction — service_role only (called from order-service.ts)',
  },
  {
    name: 'seat_queue_entry_atomic',
    allowedRoles: ['authenticated', 'service_role'],
    internalAuthCheck: true,
    callerType: 'privileged',
    description: 'Staff seating — authenticated + service_role; internal has_permission() check',
  },
  {
    name: 'join_queue_atomic',
    allowedRoles: ['anon', 'authenticated', 'service_role'],
    internalAuthCheck: false,
    callerType: 'public',
    description: 'Customer queue join — intentionally public (no auth required)',
  },
  {
    name: 'get_queue_metrics_summary',
    allowedRoles: ['authenticated', 'service_role'],
    internalAuthCheck: true,
    callerType: 'privileged',
    description: 'Analytics — authenticated + service_role; internal membership check',
  },
  {
    name: 'get_hourly_queue_volume',
    allowedRoles: ['authenticated', 'service_role'],
    internalAuthCheck: true,
    callerType: 'privileged',
    description: 'Analytics — authenticated + service_role; internal membership check',
  },
  {
    name: 'get_commerce_metrics_summary',
    allowedRoles: ['authenticated', 'service_role'],
    internalAuthCheck: true,
    callerType: 'privileged',
    description: 'Analytics — authenticated + service_role; internal membership check',
  },
];

function canRole(rpc: RPCPolicy, role: Role): boolean {
  return rpc.allowedRoles.includes(role);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RPC Security Policy — Internal-only functions', () => {
  const internalFunctions = RPC_POLICIES.filter(r => r.callerType === 'internal');

  it('only service_role can call internal RPCs', () => {
    for (const rpc of internalFunctions) {
      expect(canRole(rpc, 'service_role')).toBe(true);
      expect(canRole(rpc, 'anon')).toBe(false);
      expect(canRole(rpc, 'authenticated')).toBe(false);
    }
  });

  it('claim_outbox_events is service_role only', () => {
    const rpc = RPC_POLICIES.find(r => r.name === 'claim_outbox_events')!;
    expect(canRole(rpc, 'service_role')).toBe(true);
    expect(canRole(rpc, 'anon')).toBe(false);
    expect(canRole(rpc, 'authenticated')).toBe(false);
  });

  it('recover_stale_outbox_events is service_role only', () => {
    const rpc = RPC_POLICIES.find(r => r.name === 'recover_stale_outbox_events')!;
    expect(canRole(rpc, 'service_role')).toBe(true);
    expect(canRole(rpc, 'anon')).toBe(false);
    expect(canRole(rpc, 'authenticated')).toBe(false);
  });

  it('deduct_inventory_atomic is service_role only', () => {
    const rpc = RPC_POLICIES.find(r => r.name === 'deduct_inventory_atomic')!;
    expect(canRole(rpc, 'service_role')).toBe(true);
    expect(canRole(rpc, 'anon')).toBe(false);
    expect(canRole(rpc, 'authenticated')).toBe(false);
  });
});

describe('RPC Security Policy — Privileged functions (with internal auth check)', () => {
  it('seat_queue_entry_atomic: anon blocked; authenticated+service_role allowed', () => {
    const rpc = RPC_POLICIES.find(r => r.name === 'seat_queue_entry_atomic')!;
    expect(canRole(rpc, 'anon')).toBe(false);          // ← CRITICAL: anon blocked
    expect(canRole(rpc, 'authenticated')).toBe(true);  // function checks has_permission internally
    expect(canRole(rpc, 'service_role')).toBe(true);
    expect(rpc.internalAuthCheck).toBe(true);
  });

  it('analytics RPCs: anon blocked; authenticated+service_role allowed with membership check', () => {
    const analyticsRpcs = ['get_queue_metrics_summary', 'get_hourly_queue_volume', 'get_commerce_metrics_summary'];
    for (const name of analyticsRpcs) {
      const rpc = RPC_POLICIES.find(r => r.name === name)!;
      expect(canRole(rpc, 'anon')).toBe(false);
      expect(canRole(rpc, 'authenticated')).toBe(true);
      expect(canRole(rpc, 'service_role')).toBe(true);
      expect(rpc.internalAuthCheck).toBe(true);
    }
  });
});

describe('RPC Security Policy — Public functions', () => {
  it('join_queue_atomic: accessible to anon (intentionally public queue joining)', () => {
    const rpc = RPC_POLICIES.find(r => r.name === 'join_queue_atomic')!;
    expect(canRole(rpc, 'anon')).toBe(true);
    expect(canRole(rpc, 'authenticated')).toBe(true);
    expect(canRole(rpc, 'service_role')).toBe(true);
    expect(rpc.internalAuthCheck).toBe(false);
  });
});

describe('RPC Security Policy — Completeness', () => {
  it('all 8 security-sensitive RPCs are documented in policy table', () => {
    expect(RPC_POLICIES).toHaveLength(8);
  });

  it('every RPC has at least service_role access', () => {
    for (const rpc of RPC_POLICIES) {
      expect(canRole(rpc, 'service_role')).toBe(true);
    }
  });

  it('no internal RPC allows anon or authenticated access', () => {
    for (const rpc of RPC_POLICIES.filter(r => r.callerType === 'internal')) {
      expect(canRole(rpc, 'anon')).toBe(false);
      expect(canRole(rpc, 'authenticated')).toBe(false);
    }
  });
});

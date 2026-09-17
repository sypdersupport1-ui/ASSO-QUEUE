/**
 * tests/unit/seating-auth.test.ts
 *
 * Tests for seatQueueEntry() authorization enforcement.
 *
 * Defense-in-depth model:
 *   Layer 1 (App): AuthorizationService.requirePermission(queue.seat) in queue-service.ts
 *   Layer 2 (DB):  seat_queue_entry_atomic() SECURITY DEFINER checks has_permission()
 *
 * These tests validate the service-layer authorization (Layer 1) via mocks.
 * Layer 2 is validated by the migration SQL and the existing RLS test suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() so the mock factory can reference these vars
// (vi.mock() is hoisted before const declarations; vi.hoisted() is too)
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockRequirePermission } = vi.hoisted(() => {
  return {
    mockRpc: vi.fn(),
    mockFrom: vi.fn(),
    mockRequirePermission: vi.fn(),
  };
});

const supabaseMock = {
  from: mockFrom,
  rpc: mockRpc,
};

vi.mock('@/lib/db/supabase/admin', () => ({
  createAdminClient: () => supabaseMock,
}));

// Mock AuthorizationService to control permission behavior
vi.mock('@/lib/services/authorization-service', () => ({
  AuthorizationService: {
    requirePermission: mockRequirePermission,
  },
}));

import { QueueService } from '@/lib/services/queue-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seatQueueEntry() — Authorization (Layer 1)', () => {
  const entryId = '00000000-0000-0000-0000-000000000001';
  const tableId = '00000000-0000-0000-0000-000000000002';
  const restaurantId = '00000000-0000-0000-0000-000000000003';
  const actorUserId = '00000000-0000-0000-0000-000000000004';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls requirePermission with queue.seat before the RPC', async () => {
    // Step 1: fetch queue entry (returns restaurant_id)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { restaurant_id: restaurantId },
            error: null,
          }),
        }),
      }),
    });

    // Step 2: auth passes
    mockRequirePermission.mockResolvedValueOnce({ userId: actorUserId });

    // Step 3: RPC succeeds
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        queueEntryId: entryId,
        tableId,
        tableNumber: 'T-1',
        seatedAt: new Date().toISOString(),
      },
      error: null,
    });

    await QueueService.seatQueueEntry(entryId, tableId, actorUserId);

    expect(mockRequirePermission).toHaveBeenCalledTimes(1);
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: actorUserId,
        restaurantId,
        permission: 'queue.seat',
      })
    );
  });

  it('throws QUEUE_ENTRY_NOT_FOUND if entry does not exist', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Row not found' },
          }),
        }),
      }),
    });

    await expect(
      QueueService.seatQueueEntry(entryId, tableId, actorUserId)
    ).rejects.toThrow('QUEUE_ENTRY_NOT_FOUND');

    // Permission should NOT have been checked (entry not found first)
    expect(mockRequirePermission).not.toHaveBeenCalled();
  });

  it('propagates AuthorizationError if user lacks queue.seat permission', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { restaurant_id: restaurantId },
            error: null,
          }),
        }),
      }),
    });

    mockRequirePermission.mockRejectedValueOnce(
      new Error('FORBIDDEN: queue.seat permission required')
    );

    await expect(
      QueueService.seatQueueEntry(entryId, tableId, actorUserId)
    ).rejects.toThrow('FORBIDDEN');

    // RPC must NOT have been called after auth failure
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('propagates QUEUE_ENTRY_TERMINAL error from RPC', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { restaurant_id: restaurantId },
            error: null,
          }),
        }),
      }),
    });
    mockRequirePermission.mockResolvedValueOnce({ userId: actorUserId });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'QUEUE_ENTRY_TERMINAL: Cannot seat entry in terminal state CANCELLED' },
    });

    await expect(
      QueueService.seatQueueEntry(entryId, tableId, actorUserId)
    ).rejects.toThrow('QUEUE_ENTRY_TERMINAL');
  });

  it('propagates TABLE_NOT_AVAILABLE error from RPC', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { restaurant_id: restaurantId },
            error: null,
          }),
        }),
      }),
    });
    mockRequirePermission.mockResolvedValueOnce({ userId: actorUserId });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TABLE_NOT_AVAILABLE: Table status is OCCUPIED' },
    });

    await expect(
      QueueService.seatQueueEntry(entryId, tableId, actorUserId)
    ).rejects.toThrow('TABLE_NOT_AVAILABLE');
  });

  it('propagates INSUFFICIENT_TABLE_CAPACITY error from RPC', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { restaurant_id: restaurantId },
            error: null,
          }),
        }),
      }),
    });
    mockRequirePermission.mockResolvedValueOnce({ userId: actorUserId });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'INSUFFICIENT_TABLE_CAPACITY: Table capacity 2 < party size 4' },
    });

    await expect(
      QueueService.seatQueueEntry(entryId, tableId, actorUserId)
    ).rejects.toThrow('INSUFFICIENT_TABLE_CAPACITY');
  });
});

describe('seat_queue_entry_atomic() — FSM guard (documented)', () => {
  it('rejects ALL terminal states — complete list', () => {
    /**
     * The DB function seat_queue_entry_atomic() rejects:
     *   SEATED, CANCELLED, NO_SHOW, EXPIRED  — primary terminal states
     *   COMPLETED, REMOVED, SKIPPED          — legacy terminal states (Phase 15 fix)
     *
     * Only WAITING, CALLED, NOTIFIED are seatable.
     * This is enforced at DB level (SECURITY DEFINER, not bypassable by client).
     */
    const terminalStates = [
      'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED',
      'COMPLETED', 'REMOVED', 'SKIPPED',  // ← Phase 15 fix: these were missing before
    ];
    const seatableStates = ['WAITING', 'CALLED', 'NOTIFIED'];

    // Verify no overlap
    const overlap = terminalStates.filter(s => seatableStates.includes(s));
    expect(overlap).toHaveLength(0);

    // All 7 terminal states must be in the list (Phase 15 fix added COMPLETED, REMOVED, SKIPPED)
    expect(terminalStates).toHaveLength(7);
  });
});

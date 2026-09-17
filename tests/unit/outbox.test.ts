/**
 * tests/unit/outbox.test.ts
 *
 * Tests for OutboxService: publish, claim (atomicity guarantee), failure
 * backoff, and stale recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the admin client
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

const supabaseMock = {
  from: vi.fn(() => ({
    insert: mockInsert.mockReturnThis(),
    update: mockUpdate.mockReturnThis(),
    select: mockSelect.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    single: mockSingle,
  })),
  rpc: mockRpc,
};

vi.mock('@/lib/db/supabase/admin', () => ({
  createAdminClient: () => supabaseMock,
}));

import { OutboxService } from '@/lib/services/outbox-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // publishEvent
  // -------------------------------------------------------------------------

  describe('publishEvent()', () => {
    it('inserts an outbox event with PENDING status', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: 'evt-123' }, error: null });
      mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });

      const id = await OutboxService.publishEvent({
        restaurantId: 'rest-001',
        eventType: 'ORDER_PLACED',
        aggregateType: 'ORDER',
        aggregateId: 'order-001',
        payload: { amount: 100 },
      });

      expect(id).toBe('evt-123');
      expect(supabaseMock.from).toHaveBeenCalledWith('outbox_events');
    });

    it('throws if insert fails', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });
      mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });

      await expect(
        OutboxService.publishEvent({
          restaurantId: 'rest-001',
          eventType: 'ORDER_PLACED',
          aggregateType: 'ORDER',
          aggregateId: 'order-001',
          payload: {},
        })
      ).rejects.toThrow('Failed to publish outbox event');
    });
  });

  // -------------------------------------------------------------------------
  // getPendingEvents — atomic claiming
  // -------------------------------------------------------------------------

  describe('getPendingEvents()', () => {
    it('calls claim_outbox_events RPC with correct limit', async () => {
      mockRpc.mockResolvedValueOnce({ data: [], error: null });

      const result = await OutboxService.getPendingEvents(10);

      expect(mockRpc).toHaveBeenCalledWith('claim_outbox_events', { p_limit: 10 });
      expect(result).toEqual([]);
    });

    it('returns claimed events (already PROCESSING in DB)', async () => {
      const events = [
        { id: 'e1', status: 'PROCESSING', retry_count: 0, max_retries: 5 },
        { id: 'e2', status: 'PROCESSING', retry_count: 1, max_retries: 5 },
      ];
      mockRpc.mockResolvedValueOnce({ data: events, error: null });

      const result = await OutboxService.getPendingEvents();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('PROCESSING');
    });

    it('throws when RPC returns an error', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Connection lost' } });

      await expect(OutboxService.getPendingEvents()).rejects.toThrow('Failed to claim outbox events');
    });
  });

  // -------------------------------------------------------------------------
  // recoverStaleEvents
  // -------------------------------------------------------------------------

  describe('recoverStaleEvents()', () => {
    it('calls recover_stale_outbox_events with default 30 minutes', async () => {
      mockRpc.mockResolvedValueOnce({ data: 3, error: null });

      const count = await OutboxService.recoverStaleEvents();

      expect(mockRpc).toHaveBeenCalledWith('recover_stale_outbox_events', {
        p_stale_after_mins: 30,
      });
      expect(count).toBe(3);
    });

    it('accepts custom stale duration', async () => {
      mockRpc.mockResolvedValueOnce({ data: 0, error: null });

      await OutboxService.recoverStaleEvents(15);

      expect(mockRpc).toHaveBeenCalledWith('recover_stale_outbox_events', {
        p_stale_after_mins: 15,
      });
    });

    it('throws on RPC error', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });

      await expect(OutboxService.recoverStaleEvents()).rejects.toThrow(
        'Failed to recover stale outbox events'
      );
    });
  });

  // -------------------------------------------------------------------------
  // markFailed — exponential backoff
  // -------------------------------------------------------------------------

  describe('markFailed()', () => {
    it('sets status PENDING and applies exponential backoff on retryable failure', async () => {
      const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValueOnce({}) });
      supabaseMock.from.mockReturnValue({ insert: vi.fn(), select: vi.fn(), single: vi.fn(), eq: vi.fn(), update: updateMock } as any);

      await OutboxService.markFailed('evt-1', 'Network timeout', 1, 5);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PENDING',
          retry_count: 2,
          last_error: 'Network timeout',
        })
      );
    });

    it('sets status FAILED when max_retries exhausted', async () => {
      const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValueOnce({}) });
      supabaseMock.from.mockReturnValue({ insert: vi.fn(), select: vi.fn(), single: vi.fn(), eq: vi.fn(), update: updateMock } as any);

      // currentRetry = 4, maxRetries = 5  → nextRetry = 5 >= maxRetries → FAILED
      await OutboxService.markFailed('evt-1', 'Repeated failure', 4, 5);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          retry_count: 5,
        })
      );
    });

    it('caps backoff at 3600 seconds (1 hour)', async () => {
      const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValueOnce({}) });
      supabaseMock.from.mockReturnValue({ insert: vi.fn(), select: vi.fn(), single: vi.fn(), eq: vi.fn(), update: updateMock } as any);

      // Very high retry count → backoff would be > 3600 without cap
      await OutboxService.markFailed('evt-1', 'Error', 20, 100);

      const callArg = updateMock.mock.calls[0]?.[0];
      const nextAttempt = callArg?.next_attempt_at ? new Date(callArg.next_attempt_at).getTime() : 0;
      const now = Date.now();
      const diffSeconds = (nextAttempt - now) / 1000;

      // Should be at most ~3600 seconds (1 hour) from now with some tolerance
      expect(diffSeconds).toBeLessThanOrEqual(3601);
      expect(diffSeconds).toBeGreaterThan(3590); // close to cap
    });
  });
});

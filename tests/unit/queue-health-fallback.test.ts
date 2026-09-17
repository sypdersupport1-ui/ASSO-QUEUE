import { describe, it, expect } from 'vitest';
import { QueueService } from '@/lib/services/queue-service';

describe('Queue health fallback — never crashes the page', () => {
  it('handles empty data', () => {
    const h = QueueService.buildFallbackQueueHealth({
      restaurant: {},
      activeEntries: [],
      tables: [],
    });
    expect(h.health).toBe('EMPTY');
    expect(h.activeCount).toBe(0);
    expect(h.scheduledOpen).toBe(true);
    expect(h.nextOpening).toBeNull();
  });

  it('handles undefined/null garbage without throwing', () => {
    const h = QueueService.buildFallbackQueueHealth({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restaurant: null as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeEntries: null as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tables: null as any,
    });
    expect(h.health).toBeDefined();
    expect(h.activeCount).toBe(0);
  });

  it('classifies CLOSED / PAUSED', () => {
    const closed = QueueService.buildFallbackQueueHealth({
      restaurant: { queue_enabled: true, queue_operating_state: 'CLOSED', status: 'ACTIVE' },
      activeEntries: [{ status: 'WAITING', joined_at: new Date().toISOString() }],
      tables: [],
    });
    expect(closed.health).toBe('CLOSED');

    const paused = QueueService.buildFallbackQueueHealth({
      restaurant: { queue_enabled: true, queue_operating_state: 'PAUSED', status: 'ACTIVE' },
      activeEntries: [{ status: 'WAITING', joined_at: new Date().toISOString() }],
      tables: [],
    });
    expect(paused.health).toBe('PAUSED');
  });

  it('counts overdue CALLED and marks CRITICAL', () => {
    const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const h = QueueService.buildFallbackQueueHealth({
      restaurant: { queue_enabled: true, queue_operating_state: 'OPEN', max_queue_capacity: 100, call_timeout_minutes: 15, status: 'ACTIVE' },
      activeEntries: [
        { status: 'WAITING', joined_at: new Date().toISOString() },
        { status: 'CALLED', joined_at: new Date().toISOString(), called_at: old },
      ],
      tables: [{ status: 'AVAILABLE' }],
    });
    expect(h.overdueCount).toBe(1);
    expect(h.health).toBe('CRITICAL');
    expect(h.healthReason).toContain('overdue');
  });

  it('marks BUSY at 60% and FULL flag at capacity', () => {
    const entries = Array.from({ length: 65 }, (_, i) => ({
      status: 'WAITING',
      joined_at: new Date(Date.now() - i * 60000).toISOString(),
    }));
    const h = QueueService.buildFallbackQueueHealth({
      restaurant: { queue_enabled: true, queue_operating_state: 'OPEN', max_queue_capacity: 100, status: 'ACTIVE' },
      activeEntries: entries,
      tables: [{ status: 'AVAILABLE' }],
    });
    expect(h.health).toBe('BUSY');
    expect(h.isFull).toBe(false);

    const full = QueueService.buildFallbackQueueHealth({
      restaurant: { queue_enabled: true, queue_operating_state: 'OPEN', max_queue_capacity: 10, status: 'ACTIVE' },
      activeEntries: entries.slice(0, 10),
      tables: [{ status: 'AVAILABLE' }],
    });
    expect(full.isFull).toBe(true);
    expect(full.health).toBe('CRITICAL');
  });

  it('ignores malformed timestamps instead of crashing', () => {
    const h = QueueService.buildFallbackQueueHealth({
      restaurant: { queue_enabled: true, queue_operating_state: 'OPEN', max_queue_capacity: 100, status: 'ACTIVE' },
      activeEntries: [
        { status: 'WAITING', joined_at: 'not-a-date' },
        { status: 'CALLED', joined_at: 'not-a-date', called_at: 'also-bad' },
      ],
      tables: [{ status: 'BOGUS' }],
    });
    expect(h.activeCount).toBe(2);
    expect(h.overdueCount).toBe(0);
    expect(h.oldestWaitingAgeMins).toBeNull();
  });
});

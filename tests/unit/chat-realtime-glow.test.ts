import { describe, it, expect } from 'vitest';
import { calculateDelayCountdown } from '../../src/lib/delay-timer';

describe('Realtime Chat & Delay Timer Engine', () => {
  it('correctly formats remaining delay time in MM:SS', () => {
    const now = Date.now();
    // Started 2 minutes ago with 10-minute delay => 8 minutes remaining
    const startedAtIso = new Date(now - 2 * 60 * 1000).toISOString();
    const result = calculateDelayCountdown(startedAtIso, 10, now);

    expect(result.isExpired).toBe(false);
    expect(result.remainingSec).toBe(8 * 60);
    expect(result.formatted).toBe('08:00');
    expect(result.progressPercent).toBe(80);
  });

  it('marks delay as EXPIRED when start time + delay duration has passed', () => {
    const now = Date.now();
    // Started 12 minutes ago with 10-minute delay => expired 2 minutes ago
    const startedAtIso = new Date(now - 12 * 60 * 1000).toISOString();
    const result = calculateDelayCountdown(startedAtIso, 10, now);

    expect(result.isExpired).toBe(true);
    expect(result.remainingSec).toBe(0);
    expect(result.formatted).toBe('00:00');
    expect(result.progressPercent).toBe(0);
  });

  it('computes unread message glow flag accurately', () => {
    const mockEntryWithCustomerMsg = {
      id: 'entry-123',
      chatMessages: [{ sender: 'customer', message: 'Running 5m late' }],
      call_response: null,
      lateInfo: null,
    };

    const readSet = new Set<string>();

    const hasGuestMessage =
      (mockEntryWithCustomerMsg.chatMessages || []).some((m) => m.sender === 'customer') ||
      mockEntryWithCustomerMsg.call_response === 'DELAY_REQUESTED';

    const isUnreadBefore = hasGuestMessage && !readSet.has(mockEntryWithCustomerMsg.id);
    expect(isUnreadBefore).toBe(true);

    // Staff opens chat modal => mark read
    readSet.add(mockEntryWithCustomerMsg.id);
    const isUnreadAfter = hasGuestMessage && !readSet.has(mockEntryWithCustomerMsg.id);
    expect(isUnreadAfter).toBe(false);
  });
});

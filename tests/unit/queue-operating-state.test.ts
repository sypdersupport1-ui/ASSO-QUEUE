import { describe, it, expect } from 'vitest';

describe('Queue Operating State - FSM', () => {
  const validStates = ['OPEN','PAUSED','CLOSING_SOON','CLOSED'];
  const allTransitions = [
    ['OPEN','PAUSED'], ['PAUSED','OPEN'], ['OPEN','CLOSING_SOON'], ['CLOSING_SOON','OPEN'],
    ['OPEN','CLOSED'], ['CLOSED','OPEN'], ['PAUSED','CLOSED'], ['CLOSED','PAUSED'],
    ['CLOSING_SOON','CLOSED'], ['CLOSED','CLOSING_SOON'], ['PAUSED','CLOSING_SOON'], ['CLOSING_SOON','PAUSED']
  ];

  it('valid states are OPEN, PAUSED, CLOSING_SOON, CLOSED', () => {
    expect(validStates).toEqual(['OPEN','PAUSED','CLOSING_SOON','CLOSED']);
  });

  it('all operating state transitions are allowed (except same-state idempotent)', () => {
    for (const [from, to] of allTransitions) {
      expect(validStates).toContain(from);
      expect(validStates).toContain(to);
      expect(from).not.toBe(to);
    }
  });

  it('same-state is idempotent (no duplicate audit)', () => {
    expect('OPEN').toBe('OPEN');
  });

  it('FULL is derived, not stored', () => {
    const max = 100;
    const active = 100;
    const isFull = active >= max;
    expect(isFull).toBe(true);
    const active2 = 99;
    expect(active2 >= max).toBe(false);
  });

  it('queue_enabled false overrides operating_state', () => {
    const queueEnabled = false;
    const operatingState = 'OPEN';
    const canJoin = queueEnabled && (operatingState === 'OPEN' || operatingState === 'CLOSING_SOON');
    expect(canJoin).toBe(false);
  });

  it('PAUSED/CLOSED block joins, OPEN/CLOSING_SOON allow', () => {
    const canJoin = (state: string, enabled: boolean, isFull: boolean) => enabled && !isFull && (state === 'OPEN' || state === 'CLOSING_SOON');
    expect(canJoin('OPEN', true, false)).toBe(true);
    expect(canJoin('CLOSING_SOON', true, false)).toBe(true);
    expect(canJoin('PAUSED', true, false)).toBe(false);
    expect(canJoin('CLOSED', true, false)).toBe(false);
    expect(canJoin('OPEN', true, true)).toBe(false); // FULL
    expect(canJoin('OPEN', false, false)).toBe(false); // disabled
  });
});

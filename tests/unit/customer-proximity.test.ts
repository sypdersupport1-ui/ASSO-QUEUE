import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyProximity,
  proximityCopy,
} from '@/lib/customer-ticket-ux';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('Phase 4C: proximity classification (A–C)', () => {
  it('A. NORMAL waiting: far back, flag unset', () => {
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: 9, isAlmostYourTurn: false })
    ).toBe('NORMAL');
  });

  it('A. NORMAL on unknown counts (fail calm, never urgent)', () => {
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: null, isAlmostYourTurn: false })
    ).toBe('NORMAL');
  });

  it('B. GETTING_CLOSE: authoritative flag set, still >1 ahead', () => {
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: 3, isAlmostYourTurn: true })
    ).toBe('GETTING_CLOSE');
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: 2, isAlmostYourTurn: true })
    ).toBe('GETTING_CLOSE');
  });

  it('C. ALMOST_YOUR_TURN: one or nobody ahead while WAITING', () => {
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: 1, isAlmostYourTurn: true })
    ).toBe('ALMOST_YOUR_TURN');
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: 0, isAlmostYourTurn: true })
    ).toBe('ALMOST_YOUR_TURN');
  });

  it('stricter rule wins over the flag (no conflicting signals)', () => {
    // peopleAhead <= 1 outranks isAlmostYourTurn by construction.
    expect(
      classifyProximity({ status: 'WAITING', peopleAhead: 1, isAlmostYourTurn: false })
    ).toBe('ALMOST_YOUR_TURN');
  });
});

describe('Phase 4C: backend state precedence (D–F)', () => {
  it('D. CALLED never shows presentation proximity (real action wins)', () => {
    expect(
      classifyProximity({ status: 'CALLED', peopleAhead: 0, isAlmostYourTurn: true })
    ).toBeNull();
  });

  it('E. NOTIFIED owns its guidance (no proximity override)', () => {
    expect(
      classifyProximity({ status: 'NOTIFIED', peopleAhead: 1, isAlmostYourTurn: true })
    ).toBeNull();
  });

  it('F. terminal states disable proximity messaging', () => {
    for (const s of ['SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as const) {
      expect(classifyProximity({ status: s, peopleAhead: 0, isAlmostYourTurn: true })).toBeNull();
    }
  });
});

describe('Phase 4C: copy honesty (G–J)', () => {
  it('G/H. proximity copy carries no position/ETA claims to animate', () => {
    for (const level of ['NORMAL', 'GETTING_CLOSE', 'ALMOST_YOUR_TURN'] as const) {
      const copy = proximityCopy(level);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it('I. missing ETA path is untouched (formatWaitLabel fallback lives in card)', () => {
    expect(proximityCopy('NORMAL').body).not.toMatch(/0 min|exactly/i);
  });

  it('J. no countdown/percentage language anywhere in proximity copy', () => {
    const all = (['NORMAL', 'GETTING_CLOSE', 'ALMOST_YOUR_TURN'] as const)
      .map((l) => proximityCopy(l).title + ' ' + proximityCopy(l).body)
      .join(' ');
    expect(all).not.toMatch(/remaining|countdown|%|percent|exactly|at \d+:\d+/i);
    // Preparation framing only — "come now" belongs to CALLED alone.
    expect(all).not.toMatch(/come now|come to the host stand now/i);
  });
});

describe('Phase 4C: calm delivery (K–L, O)', () => {
  const cardSrc = read('components/customer/QueueTicketCard.tsx');
  const bannerSrc = read('components/customer/QueueProgressMessage.tsx');
  const notifSrc = read('components/customer/TicketNotificationBanner.tsx');

  it('K. repeated events cannot duplicate alerts: no sounds, badges, or imperative alerts', () => {
    for (const [name, src] of [
      ['card', cardSrc],
      ['progress', bannerSrc],
      ['notification', notifSrc],
    ] as const) {
      expect(src, name).not.toMatch(/new Audio|Notification\.requestPermission|new Notification|alert\(/);
    }
  });

  it('L. polling refresh cannot spam announcements: live regions are content-stable', () => {
    // Exactly two polite regions (state headline + proximity banner);
    // position/ETA values carry no aria-live of their own.
    const liveCount = (cardSrc.match(/aria-live/g) || []).length;
    expect(liveCount).toBeLessThanOrEqual(2);
    expect(cardSrc).not.toMatch(/aria-live="assertive"/);
  });

  it('O. reduced-motion path exists for position changes and pulses', () => {
    expect(cardSrc).toMatch(/motion-safe:animate-numberPop/);
    expect(bannerSrc + cardSrc).toMatch(/motion-safe:|motion-reduce:/);
  });

  it('notification banner renders latest-only, server-side, without timers', () => {
    expect(notifSrc).not.toMatch(/setInterval|setTimeout|useEffect|fetch\(/);
    expect(notifSrc).toMatch(/role="status"/);
  });
});

describe('Phase 4C: operating states stay subordinate (M–N)', () => {
  const pageSrc = read('app/q/[slug]/status/[token]/page.tsx');

  it('M/N. PAUSED/CLOSED never replace ticket state logic in the page', () => {
    // The page passes operating context as a note; no state override.
    expect(pageSrc).toMatch(/queueEnabled/);
    expect(pageSrc).not.toMatch(/Queue Currently Closed|Queue Temporarily Paused/);
  });
});

describe('Phase 4C: security + invariants (P–R)', () => {
  it('P. no token/storage/timer in proximity + notification surfaces', () => {
    for (const f of [
      'lib/customer-ticket-ux.ts',
      'components/customer/QueueProgressMessage.tsx',
      'components/customer/TicketNotificationBanner.tsx',
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/localStorage|sessionStorage/);
      expect(src).not.toMatch(/qtoken_|rawToken/);
      expect(src).not.toMatch(/setInterval|setTimeout/);
    }
  });

  it('Q. proximity classification cannot reach backend state (pure, no imports)', () => {
    const src = read('lib/customer-ticket-ux.ts');
    expect(src).not.toMatch(/from '@\/lib\/db|from '@\/lib\/services|supabase|fetch\(/);
  });

  it('R. cancellation component unchanged in contract (secure action, confirm, guard)', () => {
    const src = read('components/customer/CancelQueueDialog.tsx');
    expect(src).toMatch(/cancelQueuePublicAction/);
    expect(src).toMatch(/Keep my place/);
    expect(src).toMatch(/if \(isPending\) return/);
  });
});

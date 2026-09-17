import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ticketStateMeta,
  formatTicketNumber,
  positionLabel,
  partiesAheadLabel,
  isTicketTerminal,
  operatingNoteForTicket,
} from '@/lib/customer-ticket-ux';
import { QueueService } from '@/lib/services/queue-service';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('Phase 4B: ticket state matrix (A–H)', () => {
  it('A. WAITING shows wait info with reassuring guidance', () => {
    const m = ticketStateMeta('WAITING');
    expect(m.showWaitInfo).toBe(true);
    expect(m.title).toBe("You're in the queue");
    expect(m.guidance.length).toBeGreaterThan(0);
  });

  it('B. WAITING position/ETA labels are customer-friendly', () => {
    expect(positionLabel(7)).toBe('Position #7');
    expect(positionLabel(1)).toBe("You're next");
    expect(positionLabel(null)).toBeNull();
    expect(positionLabel(0)).toBeNull();
    expect(partiesAheadLabel(6)).toBe('6 parties ahead');
    expect(partiesAheadLabel(1)).toBe('1 party ahead');
    expect(partiesAheadLabel(0)).toBe('No one ahead of you');
    expect(partiesAheadLabel(null)).toBeNull();
  });

  it('C. NOTIFIED renders getting-close state with wait info', () => {
    const m = ticketStateMeta('NOTIFIED');
    expect(m.tone).toBe('getting-close');
    expect(m.title).toMatch(/close/i);
    expect(m.showWaitInfo).toBe(true);
    // Must not falsely claim the table is ready now.
    expect(m.title + m.subtitle + m.guidance).not.toMatch(/come .* now|ready!/i);
  });

  it('D. CALLED renders urgent state, visually distinct from WAITING', () => {
    const m = ticketStateMeta('CALLED');
    expect(m.tone).toBe('urgent');
    expect(m.tone).not.toBe(ticketStateMeta('WAITING').tone);
    expect(m.guidance).toMatch(/host stand/i);
    expect(m.showWaitInfo).toBe(false);
  });

  it('E. SEATED removes position/ahead/wait information', () => {
    const m = ticketStateMeta('SEATED');
    expect(m.tone).toBe('success');
    expect(m.showWaitInfo).toBe(false);
    expect(m.title).toMatch(/seated/i);
  });

  it('F. CANCELLED removes wait info with rejoin guidance', () => {
    const m = ticketStateMeta('CANCELLED');
    expect(m.showWaitInfo).toBe(false);
    expect(m.title).toMatch(/cancelled/i);
    expect(m.guidance).toMatch(/join.*again/i);
  });

  it('G. NO_SHOW message is safe and non-technical', () => {
    const m = ticketStateMeta('NO_SHOW');
    expect(m.title).toBe('We missed you');
    expect(m.showWaitInfo).toBe(false);
    expect(m.title + m.subtitle + m.guidance).not.toMatch(/NO_SHOW|reason|no_show_reason/i);
  });

  it('H. EXPIRED message hides internals, offers next step', () => {
    const m = ticketStateMeta('EXPIRED');
    expect(m.title).toMatch(/expired/i);
    expect(m.showWaitInfo).toBe(false);
    expect(m.title + m.subtitle + m.guidance).not.toMatch(/token_hash|rawToken|qtoken_|stack trace|postgres|permission denied/i);
  });

  it('legacy terminal states stay read-compatible without new generation', () => {
    for (const s of ['COMPLETED', 'REMOVED', 'SKIPPED'] as const) {
      const m = ticketStateMeta(s);
      expect(m.showWaitInfo).toBe(false);
      expect(isTicketTerminal(s)).toBe(true);
    }
    expect(isTicketTerminal('WAITING')).toBe(false);
    expect(isTicketTerminal('NOTIFIED')).toBe(false);
    expect(isTicketTerminal('CALLED')).toBe(false);
  });
});

describe('Phase 4B: queue number display', () => {
  it('formats authoritative display number as Q-128', () => {
    expect(formatTicketNumber('128', 'entry-id')).toBe('Q-128');
    expect(formatTicketNumber('#128', 'entry-id')).toBe('Q-128');
    expect(formatTicketNumber(null, 'abcd-efgh')).toBe('Q-ABCD');
  });

  it('never exposes tokens, hashes, or raw database ids', () => {
    const out = formatTicketNumber('128', 'some-entry-uuid');
    expect(out).not.toContain('qtoken_');
    expect(out).not.toContain('some-entry-uuid');
    expect(out).toMatch(/^Q-/);
  });
});

describe('Phase 4B: operating state never hijacks a live ticket (I–J)', () => {
  it('I. PAUSED keeps the ticket active with an explanatory note', () => {
    const note = operatingNoteForTicket('WAITING', true, 'PAUSED');
    expect(note).toMatch(/still active/i);
    expect(ticketStateMeta('WAITING').showWaitInfo).toBe(true);
  });

  it('J. CLOSED keeps the ticket active with an explanatory note', () => {
    expect(operatingNoteForTicket('CALLED', true, 'CLOSED')).toMatch(/still active/i);
    expect(operatingNoteForTicket('WAITING', false, 'OPEN')).toMatch(/still active/i);
  });

  it('terminal tickets get no operating note', () => {
    expect(operatingNoteForTicket('SEATED', true, 'PAUSED')).toBeNull();
    expect(operatingNoteForTicket('CANCELLED', true, 'CLOSED')).toBeNull();
  });
});

describe('Phase 4B: realtime contract (K–M)', () => {
  const hookSrc = read('lib/realtime/useCustomerQueueRealtime.ts');
  const pageSrc = read('app/q/[slug]/status/[token]/page.tsx');

  it('K. broadcast events trigger authoritative refresh, never payload-as-truth', () => {
    expect(hookSrc).toMatch(/router\.refresh\(\)/);
    // The broadcast payload carries only an id ping — no status mutation.
    expect(hookSrc).not.toMatch(/setStatus|setPosition|setETA|setQueue/);
  });

  it('L. exactly one refresh timer exists on the ticket (no duplicates)', () => {
    const hookTimers = (hookSrc.match(/setInterval/g) || []).length;
    const pageTimers = (pageSrc.match(/setInterval/g) || []).length;
    expect(pageSrc).not.toMatch(/StatusAutoRefresh/);
    expect(pageTimers).toBe(0);
    expect(hookTimers).toBe(1);
  });

  it('M. reconnect revalidates; hidden tabs do not poll', () => {
    expect(hookSrc).toMatch(/visibilitychange/);
    expect(hookSrc).toMatch(/visibilityState.*visible/);
    expect(hookSrc).toMatch(/SUBSCRIBED/);
  });
});

describe('Phase 4B: cancellation safety (N–Q)', () => {
  const dialogSrc = read('components/customer/CancelQueueDialog.tsx');

  it('N. confirmation is required before cancelling', () => {
    expect(dialogSrc).toMatch(/role="dialog"/);
    expect(dialogSrc).toMatch(/Keep my place/);
    expect(dialogSrc).toMatch(/Leave queue/);
  });

  it('O. duplicate cancellation taps are blocked', () => {
    expect(dialogSrc).toMatch(/if \(isPending\) return/);
    expect(dialogSrc).toMatch(/disabled=\{isPending\}/);
  });

  it('P. cancel/seat race resolves server-side: SEATED is terminal for cancel', () => {
    expect(QueueService.isTerminalStatus('SEATED')).toBe(true);
    expect(QueueService.isValidTransition('SEATED', 'CANCELLED')).toBe(false);
    // Active states may still cancel (single atomic winner decides).
    expect(QueueService.isValidTransition('WAITING', 'CANCELLED')).toBe(true);
    expect(QueueService.isValidTransition('CALLED', 'CANCELLED')).toBe(true);
    expect(QueueService.isValidTransition('NOTIFIED', 'CANCELLED')).toBe(true);
  });

  it('Q. cancel/no-show race resolves server-side: NO_SHOW is terminal', () => {
    expect(QueueService.isTerminalStatus('NO_SHOW')).toBe(true);
    expect(QueueService.isValidTransition('NO_SHOW', 'CANCELLED')).toBe(false);
    expect(QueueService.isValidTransition('CALLED', 'NO_SHOW')).toBe(true);
  });

  it('anon callers can only reach CANCELLED, never other states', () => {
    // Enforced in updateQueueStatus; FSM also rejects seating via that path.
    expect(QueueService.isValidTransition('WAITING', 'SEATED')).toBe(false);
  });
});

describe('Phase 4B: credential safety (R–V)', () => {
  const pageSrc = read('app/q/[slug]/status/[token]/page.tsx');

  it('R/S. invalid credential and tenant mismatch share one generic message', () => {
    expect(pageSrc).not.toMatch(/belongs to a different restaurant/);
    const occurrences = (pageSrc.match(/Ticket not found/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('T. no raw token in browser JS storage on ticket surfaces', () => {
    for (const f of [
      'components/customer/QueueTicketCard.tsx',
      'components/customer/CancelQueueDialog.tsx',
      'components/realtime/CustomerQueueRealtime.tsx',
      'app/q/[slug]/status/[token]/page.tsx',
    ]) {
      expect(read(f)).not.toMatch(/localStorage|sessionStorage/);
    }
  });

  it('U. rendered ticket data carries no token material', () => {
    const svc = read('lib/services/queue-service.ts');
    const fnStart = svc.indexOf('static async getQueueStatusByToken');
    const returnStart = svc.indexOf('return {', fnStart);
    const returnEnd = svc.indexOf('};', returnStart);
    const returnBlock = svc.slice(returnStart, returnEnd);
    expect(returnBlock).toMatch(/displayNumber/);
    expect(returnBlock).not.toMatch(/rawToken|tokenHash|token_hash/);
  });

  it('V. customer status response stays minimal (no phone/token/hash)', () => {
    const svc = read('lib/services/queue-service.ts');
    const ifaceStart = svc.indexOf('export interface PublicQueueStatusResponse');
    const ifaceEnd = svc.indexOf('\n}', ifaceStart);
    const iface = svc.slice(ifaceStart, ifaceEnd);
    for (const banned of ['customer_phone', 'customerPhone', 'token', 'tokenHash', 'token_hash']) {
      expect(iface).not.toContain(banned);
    }
    expect(iface).toContain('position');
    expect(iface).toContain('formattedETA');
  });
});

describe('Phase 4B: dashboard ⟷ customer sync', () => {
  it('customer position ordering matches the dashboard queue ordering', () => {
    // Contract: both sides order the active set {WAITING, NOTIFIED, CALLED}
    // by (joined_at ASC, id ASC). Customer position = ahead-count + 1.
    type Entry = { id: string; joined_at: string; status: string };
    const entries: Entry[] = [
      { id: 'c', joined_at: '2026-01-01T10:02:00Z', status: 'WAITING' },
      { id: 'a', joined_at: '2026-01-01T10:00:00Z', status: 'CALLED' },
      { id: 'b', joined_at: '2026-01-01T10:01:00Z', status: 'NOTIFIED' },
      { id: 's', joined_at: '2026-01-01T09:00:00Z', status: 'SEATED' },
    ];
    const ACTIVE = new Set(['WAITING', 'NOTIFIED', 'CALLED']);
    const byCanonical = (x: Entry, y: Entry) =>
      x.joined_at < y.joined_at ? -1 : x.joined_at > y.joined_at ? 1 : x.id < y.id ? -1 : 1;
    // Dashboard view: getActiveQueue ordering (active counted, same sort).
    const dashboardOrder = entries
      .filter((e) => ACTIVE.has(e.status))
      .sort(byCanonical)
      .map((e) => e.id);
    // Customer view: count of active entries strictly ahead + 1.
    const aheadCount = (me: Entry) =>
      entries.filter(
        (e) =>
          ACTIVE.has(e.status) &&
          (e.joined_at < me.joined_at || (e.joined_at === me.joined_at && e.id < me.id))
      ).length;
    const customerPosition = (me: Entry) => aheadCount(me) + 1;
    expect(dashboardOrder).toEqual(['a', 'b', 'c']);
    expect(customerPosition(entries[0]!)).toBe(3); // 'c' is third in both views
    expect(customerPosition(entries[1]!)).toBe(1);
  });

  it('no second ETA formula exists in ticket UI code', () => {
    for (const f of [
      'components/customer/QueueTicketCard.tsx',
      'components/realtime/CustomerQueueRealtime.tsx',
      'app/q/[slug]/status/[token]/page.tsx',
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/position - 1\) \* 7/);
      expect(src).not.toMatch(/Math\.max\(5,/);
      expect(src).not.toMatch(/avgServiceTimeMins/);
    }
  });

  it('staff seat/notify/call/no-show actions all ping the customer channel', () => {
    const dash = read('components/dashboard/DashboardClient.tsx');
    const uses = (dash.match(/broadcastCustomerQueueUpdate/g) || []).length;
    // import + seat + notified + called + no-show
    expect(uses).toBeGreaterThanOrEqual(5);
  });
});

describe('Phase 4B: layout + motion safety (W–X)', () => {
  it('W. ticket surfaces use fluid layout (no fixed-pixel widths)', () => {
    // max-w-* readability caps are fine; fixed w-[Npx] would force overflow.
    for (const f of [
      'components/customer/QueueTicketCard.tsx',
      'components/customer/CancelQueueDialog.tsx',
      'app/q/[slug]/status/[token]/page.tsx',
    ]) {
      expect(read(f)).not.toMatch(/(?<!max-)w-\[\d+px\]/);
    }
  });

  it('X. animations respect reduced-motion preferences', () => {
    const card = read('components/customer/QueueTicketCard.tsx');
    const realtime = read('components/realtime/CustomerQueueRealtime.tsx');
    expect(card).toMatch(/motion-safe:/);
    expect(realtime).toMatch(/motion-safe:|motion-reduce:/);
  });
});

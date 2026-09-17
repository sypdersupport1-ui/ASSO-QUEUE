import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ticketStateMeta,
  isTicketTerminal,
  operatingNoteForTicket,
} from '@/lib/customer-ticket-ux';
import {
  mapJoinErrorToUX,
} from '@/lib/customer-join-ux';
import {
  resumeCopyForState,
  isResumableTicketStatus,
} from '@/components/customer/TicketResumeBanner';

const root = (...p: string[]) => resolve(__dirname, '../../src', ...p);
const read = (p: string) => readFileSync(root(...p.split('/')), 'utf8');

describe('Phase 4F: cancellation & recovery polish (A–X)', () => {
  // A. successful cancellation renders CANCELLED.
  it('A. CANCELLED is terminal with calm copy and explicit rejoin action', () => {
    const meta = ticketStateMeta('CANCELLED');
    expect(meta.showWaitInfo).toBe(false);
    expect(meta.title).toBe('Queue entry cancelled');
    const card = read('components/customer/QueueTicketCard.tsx');
    // Terminal branch offers manual rejoin — never auto-join.
    expect(card).toContain('Join the queue again');
    expect(card).not.toContain('autoJoin');
  });

  // B. cancellation conflict revalidates current state.
  it('B. cancel failure never claims success; offers revalidation + retry', () => {
    const dlg = read('components/customer/CancelQueueDialog.tsx');
    expect(dlg).not.toContain('Cancellation successful');
    expect(dlg).not.toContain('successfully cancelled');
    expect(dlg).toContain('Check my ticket');
    expect(dlg).toContain('router.refresh()');
    expect(dlg).toContain('Try again');
  });

  // C. cancel + CALL race.
  it('C. cancel/call race resolves to one truth; dialog reconciles via refresh', () => {
    const svc = read('lib/services/queue-service.ts');
    // Anon callers may only reach CANCELLED; anything else is rejected.
    expect(svc).toContain('Anonymous can only cancel');
    const dlg = read('components/customer/CancelQueueDialog.tsx');
    expect(dlg).toContain('confirm leaving the queue');
  });

  // D. cancel + SEAT race.
  it('D. seating wins over late cancel: SEATED is terminal, no resurrection', () => {
    expect(isTicketTerminal('SEATED')).toBe(true);
    const svc = read('lib/services/queue-service.ts');
    expect(svc).toContain('Use seating operation for SEATED');
  });

  // E. cancel + NO_SHOW race.
  it('E. no-show wins over late cancel: authoritative NO_SHOW stands', () => {
    expect(isTicketTerminal('NO_SHOW')).toBe(true);
    expect(ticketStateMeta('NO_SHOW').showWaitInfo).toBe(false);
  });

  // F. cancel + EXPIRE race.
  it('F. expiry wins over late cancel: EXPIRED stays terminal', () => {
    expect(isTicketTerminal('EXPIRED')).toBe(true);
    expect(ticketStateMeta('EXPIRED').showWaitInfo).toBe(false);
  });

  // G. network failure produces ambiguous-safe UI.
  it('G. ambiguous failure copy never asserts an outcome', () => {
    const dlg = read('components/customer/CancelQueueDialog.tsx');
    expect(dlg).toContain('confirm leaving the queue');
    expect(dlg).not.toMatch(/cancellation failed/i);
    expect(dlg).toContain('Nothing is assumed');
  });

  // H. cancellation retry is safe.
  it('H. retry reuses the idempotent secure action (no duplicate side effects)', () => {
    const dlg = read('components/customer/CancelQueueDialog.tsx');
    // Retry calls the same server action; backend idempotency is the backstop.
    expect(dlg).toMatch(/onClick=\{handleCancel\}[\s\S]*Try again/);
    const action = read('app/q/actions.ts');
    expect(action).toContain('cancelQueuePublicAction');
  });

  // I. duplicate cancel click does not produce duplicate UI requests.
  it('I. pending state disables destructive + retry controls', () => {
    const dlg = read('components/customer/CancelQueueDialog.tsx');
    expect(dlg).toContain('if (isPending) return;');
    expect(dlg).toContain('disabled={isPending}');
    expect(dlg).toContain('Leaving…');
    expect(dlg).toContain('aria-busy={isPending}');
  });

  // J. terminal states hide active controls.
  it('J. terminals hide position/ETA/progress/cancel/proximity', () => {
    expect(read('components/customer/QueueTicketCard.tsx')).toContain('!isTerminal && (');
  });

  // K. CLOSED does not invalidate active ticket.
  it('K. closed queue keeps active tickets authoritative (subtle note only)', () => {
    expect(operatingNoteForTicket('WAITING', true, 'CLOSED')).toContain('still active');
    expect(operatingNoteForTicket('WAITING', false, 'OPEN')).toContain('still active');
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('Queue closed');
  });

  // L. PAUSED does not invalidate active ticket.
  it('L. paused queue keeps active tickets; never claims ticket is paused', () => {
    expect(operatingNoteForTicket('WAITING', true, 'PAUSED')).toContain('still active');
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('Your ticket is paused');
  });

  // M. FULL does not invalidate active ticket.
  it('M. full capacity never surfaces on an existing ticket', () => {
    expect(operatingNoteForTicket('WAITING', true, 'OPEN')).toBeNull();
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('queue is full');
    expect(card).not.toContain('Queue is full');
  });

  // N. invalid ticket generic error.
  it('N. unknown tokens get generic not-found copy (no internals)', () => {
    const page = read('app/q/[slug]/status/[token]/page.tsx');
    expect(page).toContain('Ticket not found');
    expect(page).not.toContain('token_hash');
    expect(page).not.toContain('restaurant_id');
  });

  // O. cross-tenant ticket remains inaccessible.
  it('O. tenant mismatch renders the same generic not-found state', () => {
    const page = read('app/q/[slug]/status/[token]/page.tsx');
    expect(page).toContain('status.restaurantId !== restaurant.id');
    // Generic message shared with the plain not-found path.
    expect(page.match(/couldn't find a valid queue ticket/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // P. NO_SHOW recovery copy.
  it('P. no-show copy is calm, explains, and offers explicit rejoin', () => {
    expect(ticketStateMeta('NO_SHOW').title).toBe('We missed you');
    expect(ticketStateMeta('NO_SHOW').guidance).toContain('join the queue again');
  });

  // Q. EXPIRED recovery copy.
  it('Q. expired copy never implies resurrection', () => {
    expect(ticketStateMeta('EXPIRED').title).toBe('This ticket has expired');
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('restore');
    expect(card).not.toContain('reactivate');
  });

  // R. REJOIN creates explicit new join action only.
  it('R. rejoin is a manual link into the join flow (no auto-submit)', () => {
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('autoJoin');
    expect(card).not.toContain('router.push(`/q/');
  });

  // S. rejoin never resurrects previous ticket.
  it('S. no stale number/entry/token reuse on rejoin paths', () => {
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('previousToken');
    expect(card).not.toContain('oldToken');
    const landing = read('app/q/[slug]/page.tsx');
    // A fresh join form (or a live-ticket resume) — never a resurrected ticket.
    expect(landing).toContain('QueueJoinForm');
  });

  // T. offline display preserves known state.
  it('T. ticket markup never unmounts on disconnect', () => {
    const indicator = read('components/realtime/CustomerQueueRealtime.tsx');
    expect(indicator).toContain('ticket still valid');
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    // Disconnect only flips the indicator state — never clearsUI data.
    expect(hook).not.toContain('setTicket');
    expect(hook).not.toContain('clearTicket');
  });

  // U. reconnect revalidates.
  it('U. online return performs authoritative refresh', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook).toContain("window.addEventListener('online'");
    expect(hook).toContain('revalidate()');
  });

  // V. resume banner reflects current ticket state.
  it('V. resume copy per state; dead terminals excluded', () => {
    expect(resumeCopyForState('WAITING').title).toBe('You have an active ticket');
    expect(resumeCopyForState('NOTIFIED').title).toBe('Your turn is getting closer');
    expect(resumeCopyForState('CALLED').title).toBe('Your turn is being called');
    expect(resumeCopyForState('SEATED').title).toBe("You're seated — enjoy!");
    expect(isResumableTicketStatus('CANCELLED')).toBe(false);
    expect(isResumableTicketStatus('NO_SHOW')).toBe(false);
    expect(isResumableTicketStatus('EXPIRED')).toBe(false);
  });

  // W. no raw token browser storage.
  it('W. cancel dialog and ticket components use zero web storage', () => {
    for (const f of [
      'components/customer/CancelQueueDialog.tsx',
      'components/customer/CustomerErrorState.tsx',
      'app/q/actions.ts',
    ]) {
      const code = read(f);
      expect(code).not.toMatch(/localStorage\s*\.\s*(getItem|setItem|removeItem|clear)/);
      expect(code).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem|removeItem|clear)/);
    }
  });

  // X. no new timer/realtime subscription introduced.
  it('X. single fallback interval, single ticket subscription, no added polling', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook.match(/setInterval/g)?.length ?? 0).toBe(1);
    // One subscribe for the ticket channel; the staff broadcast helper only
    // sends a ping (its own transient channel), never subscribes to state.
    expect(hook).toContain('supabase.channel(channelName)');
    expect(hook).toContain("channel.on('broadcast'");
    const landing = read('components/customer/LandingAutoRefresh.tsx');
    expect(landing.match(/setInterval/g)?.length ?? 0).toBe(1);
  });

  // Join-failure recovery mapping stays intentional (supports §19).
  it('join failures map to calm actionable copy with explicit retryability', () => {
    expect(mapJoinErrorToUX('QUEUE_FULL').kind).toBe('FULL');
    expect(mapJoinErrorToUX('Too many requests').retryable).toBe(true);
    expect(mapJoinErrorToUX('QUEUE_PAUSED').kind).toBe('PAUSED');
    expect(mapJoinErrorToUX('QUEUE_OUTSIDE_OPERATING_HOURS').kind).toBe('CLOSED');
    expect(mapJoinErrorToUX('DUPLICATE_ACTIVE_ENTRY').retryable).toBe(false);
    expect(mapJoinErrorToUX('mystery-boom').kind).toBe('GENERIC_SERVER_ERROR');
  });
});

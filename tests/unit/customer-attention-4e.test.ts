import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ticketStateMeta,
  shouldShowNotificationBanner,
  isTicketTerminal,
  customerAttentionLevel,
  isCalledNotification,
} from '@/lib/customer-ticket-ux';
import {
  resumeCopyForState,
  isResumableTicketStatus,
} from '@/components/customer/TicketResumeBanner';

const root = (...p: string[]) => resolve(__dirname, '../../src', ...p);
const read = (p: string) => readFileSync(root(...p.split('/')), 'utf8');

const CALLED_NOTIF = {
  title: 'Your table is ready!',
  message: 'Ticket Q-3 — Ravi is ready. Please come to the host stand now.',
};
const INFO_NOTIF = {
  title: 'Almost your turn!',
  message: 'Hi Ravi, you’re almost up! Ticket Q-3 — please stay nearby.',
};
const ORDER_NOTIF = {
  title: 'Order Received',
  message: 'Order #ORD-1234 has been placed.',
};

describe('Phase 4E: customer attention & return-to-restaurant experience (A–T)', () => {
  // A. customer becomes CALLED → CALLED hero wins.
  it('A. CALLED hero wins: authoritative copy present, wait metrics hidden', () => {
    const meta = ticketStateMeta('CALLED');
    expect(meta.showWaitInfo).toBe(false);
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).toContain('YOUR TURN IS HERE');
    expect(card).toContain('Please return to the restaurant now.');
  });

  // B. persisted CALLED notification does not duplicate CALLED hero.
  it('B. called-type persisted notification is suppressed under CALLED', () => {
    expect(shouldShowNotificationBanner('CALLED', CALLED_NOTIF)).toBe(false);
    // A stale "almost your turn" message would contradict the CALLED hero.
    expect(shouldShowNotificationBanner('CALLED', INFO_NOTIF)).toBe(false);
    // Genuinely different info may still show as secondary context.
    expect(shouldShowNotificationBanner('CALLED', ORDER_NOTIF)).toBe(true);
  });

  // C. customer returns to visible tab → authoritative refresh.
  it('C. visibility return triggers authoritative router.refresh (no client truth)', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook).toContain('visibilitychange');
    expect(hook).toContain('router.refresh()');
    // No client-side status cache: the only state held is connection state.
    expect(hook).not.toMatch(/useState<[^>]*QueueStatus/);
  });

  // D. missed realtime event is recovered by refresh.
  it('D. every trigger re-reads server truth; broadcasts carry no state', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    // Broadcast handler ignores payload and revalidates.
    expect(hook).toMatch(/channel\.on\('broadcast', \{ event: 'queue_update' \}/);
    expect(hook).not.toContain('setQueueStatus');
    expect(hook).not.toContain('localStorage');
  });

  // E. reconnect → authoritative refresh.
  it('E. online event triggers immediate authoritative refresh', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook).toContain("window.addEventListener('online'");
    // Throttle guard exists so flaps cannot flood the server — still no timer.
    expect(hook).toContain('lastRecoveryRef');
    expect(hook.match(/setInterval/g)?.length ?? 0).toBe(1);
  });

  // F. CALLED remains CALLED when customer returns later.
  it('F. CALLED presentation is time-independent (no "just happened" fiction)', () => {
    expect(ticketStateMeta('CALLED').title).toBe('Your table is being called');
    expect(customerAttentionLevel('CALLED', null)).toBe('CALLED');
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).not.toContain('just got called');
  });

  // G. SEATED supersedes old CALLED notification.
  it('G. seated hero wins; called-type banner suppressed under SEATED', () => {
    expect(ticketStateMeta('SEATED').tone).toBe('success');
    expect(shouldShowNotificationBanner('SEATED', CALLED_NOTIF)).toBe(false);
    expect(shouldShowNotificationBanner('SEATED', INFO_NOTIF)).toBe(false);
  });

  // H. NO_SHOW supersedes old CALLED notification.
  it('H. stale called-type banner suppressed under NO_SHOW terminal', () => {
    expect(isTicketTerminal('NO_SHOW')).toBe(true);
    expect(shouldShowNotificationBanner('NO_SHOW', CALLED_NOTIF)).toBe(false);
    expect(ticketStateMeta('NO_SHOW').title).toBe('We missed you');
  });

  // I. CANCELLED remains terminal.
  it('I. cancelled is terminal: no reactivation, no auto-rejoin', () => {
    expect(isTicketTerminal('CANCELLED')).toBe(true);
    expect(shouldShowNotificationBanner('CANCELLED', CALLED_NOTIF)).toBe(false);
    const card = read('components/customer/QueueTicketCard.tsx');
    // Terminal tickets offer a manual join link only — never silent rejoin.
    expect(card).not.toContain('autoJoin');
    expect(card).toContain('Join the queue again');
  });

  // J. repeated realtime events create no duplicate user-facing notification.
  it('J. broadcast handler only revalidates; never writes notifications', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook).not.toContain('publishEvent');
    expect(hook).not.toContain('.insert(');
    expect(hook).not.toContain('NotificationService');
  });

  // K. repeated refreshes create no duplicate notification records.
  it('K. ticket read path is side-effect free (no inserts/publishes)', () => {
    const page = read('app/q/[slug]/status/[token]/page.tsx');
    expect(page).not.toContain('.insert(');
    expect(page).not.toContain('publishEvent');
    expect(page).not.toContain('processOutboxEvent');
  });

  // L. notification lookup is customer-scoped.
  it('L. notifications resolve from token-derived entry+restaurant only', () => {
    const route = read('app/api/customer/notifications/route.ts');
    expect(route).toContain('getQueueStatusByToken');
    expect(route).toContain('getCustomerNotificationsByQueueId(');
    expect(route).not.toContain('queueEntryId');
    const svc = read('lib/services/notification-service.ts');
    expect(svc).toContain(".eq('queue_entry_id', queueEntryId)");
    expect(svc).toContain(".eq('restaurant_id', restaurantId)");
  });

  // M. notification IDs cannot read another customer's notification.
  it('M. cross-tenant access yields generic 404, never another customer’s data', () => {
    const route = read('app/api/customer/notifications/route.ts');
    expect(route).toContain('Invalid or expired token.');
    expect(route).not.toContain('restaurant_id');
    // Slug cross-check pattern shared with the ticket page.
    const page = read('app/q/[slug]/status/[token]/page.tsx');
    expect(page).toContain('status.restaurantId !== restaurant.id');
  });

  // N. no raw token in notification payload.
  it('N. persisted notification messages carry no bearer tokens', () => {
    const svc = read('lib/services/notification-service.ts');
    expect(svc).not.toMatch(/rawToken|orderToken|qtoken/i);
    const provider = read('lib/notifications/providers/in-app-provider.ts');
    expect(provider).not.toMatch(/rawToken|orderToken|qtoken/i);
  });

  // O. no raw token in browser storage.
  it('O. customer realtime/ticket code never touches web storage', () => {
    for (const f of [
      'lib/realtime/useCustomerQueueRealtime.ts',
      'components/realtime/CustomerQueueRealtime.tsx',
      'components/customer/QueueTicketCard.tsx',
      'components/customer/TicketCookieSync.tsx',
    ]) {
      const code = read(f);
      // Comments may discuss storage; only real API usage is prohibited.
      expect(code).not.toMatch(/localStorage\s*\.\s*(getItem|setItem|removeItem|clear)/);
      expect(code).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem|removeItem|clear)/);
    }
  });

  // P. offline state preserves last known ticket view.
  it('P. disconnect never clears the ticket; fallback gated on online', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook).toContain('navigator.onLine');
    const indicator = read('components/realtime/CustomerQueueRealtime.tsx');
    expect(indicator).toContain('Reconnecting…');
    expect(indicator).toContain('ticket still valid');
  });

  // Q. reduced-motion behavior.
  it('Q. attention animations respect reduced motion', () => {
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).toContain('motion-safe:');
    const indicator = read('components/realtime/CustomerQueueRealtime.tsx');
    expect(indicator).toContain('motion-reduce:animate-none');
  });

  // R. accessibility announcement does not repeat every fallback refresh.
  it('R. live announcements fire only on genuine status transitions', () => {
    const card = read('components/customer/QueueTicketCard.tsx');
    expect(card).toContain('prevStatusRef');
    expect(card).toContain('aria-live="polite"');
  });

  // S. resume banner reflects current ticket state.
  it('S. resume copy per state; dead terminals never resume', () => {
    expect(resumeCopyForState('CALLED').title).toBe('Your turn is being called');
    expect(resumeCopyForState('SEATED').title).toBe("You're seated — enjoy!");
    expect(resumeCopyForState('WAITING').title).toBe('You have an active ticket');
    expect(isResumableTicketStatus('WAITING')).toBe(true);
    expect(isResumableTicketStatus('CALLED')).toBe(true);
    expect(isResumableTicketStatus('SEATED')).toBe(true);
    expect(isResumableTicketStatus('CANCELLED')).toBe(false);
    expect(isResumableTicketStatus('NO_SHOW')).toBe(false);
    expect(isResumableTicketStatus('EXPIRED')).toBe(false);
  });

  // T. no automatic browser notification permission request.
  it('T. no Notification API permission prompts anywhere in src', () => {
    const { execSync } = require('node:child_process');
    const hits = execSync(
      'grep -rn "Notification.requestPermission\\|new Notification(" src/ --include="*.ts" --include="*.tsx" || true',
      { encoding: 'utf8' }
    ).trim();
    expect(hits).toBe('');
  });

  // Attention model sanity (supports A–I).
  it('attention levels: CALLED > ALMOST_YOUR_TURN > GETTING_CLOSE > NORMAL', () => {
    expect(customerAttentionLevel('CALLED', 'ALMOST_YOUR_TURN')).toBe('CALLED');
    expect(customerAttentionLevel('WAITING', 'ALMOST_YOUR_TURN')).toBe('ALMOST_YOUR_TURN');
    expect(customerAttentionLevel('WAITING', 'GETTING_CLOSE')).toBe('GETTING_CLOSE');
    expect(customerAttentionLevel('WAITING', null)).toBe('NORMAL');
    expect(customerAttentionLevel('NOTIFIED', 'ALMOST_YOUR_TURN')).toBe('NORMAL');
    expect(isCalledNotification(CALLED_NOTIF)).toBe(true);
    // "Almost your turn" also counts as turn-messaging (it would contradict
    // a CALLED hero); order updates are genuinely different information.
    expect(isCalledNotification(INFO_NOTIF)).toBe(true);
    expect(isCalledNotification(ORDER_NOTIF)).toBe(false);
  });
});

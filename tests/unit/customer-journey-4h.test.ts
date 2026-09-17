import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { customerOrderStatusCopy } from '@/lib/customer-order-ux';
import {
  ticketStateMeta,
  isTicketTerminal,
  customerAttentionLevel,
} from '@/lib/customer-ticket-ux';
import {
  resumeCopyForState,
  isResumableTicketStatus,
} from '@/components/customer/TicketResumeBanner';

const root = (...p: string[]) => resolve(__dirname, '../../src', ...p);
const read = (p: string) => readFileSync(root(...p.split('/')), 'utf8');

/**
 * Phase 4H — journey consistency: the whole customer surface behaves as
 * ONE coherent product. Contract-style assertions (no brittle snapshots).
 */
describe('Phase 4H: journey consistency', () => {
  // Navigation: every step links its neighbors; nobody gets trapped.
  it('menu links back to the ticket; ticket links to the menu', () => {
    expect(read('app/q/[slug]/menu/page.tsx')).toContain('My Ticket');
    const ticket = read('app/q/[slug]/status/[token]/page.tsx');
    expect(ticket).toContain('/menu?qtoken=');
  });

  it('cart drawer and order page both offer an explicit ticket return', () => {
    expect(read('components/customer/CustomerMenuBrowser.tsx')).toContain('My ticket →');
    expect(read('app/q/[slug]/order/[token]/page.tsx')).toContain('Back to My Ticket');
  });

  it('payment page never strands the customer (ticket link or queue link)', () => {
    const pay = read('app/q/[slug]/payment/[orderToken]/page.tsx');
    expect(pay).toContain('Back to My Ticket');
    expect(pay).toContain('Back to Queue');
    expect(pay).toContain('qtoken');
  });

  it('order confirmation passes the queue credential forward, never stores it', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('?qtoken=${encodeURIComponent(queueToken)}');
    expect(browser).not.toMatch(/sessionStorage\.setItem\([^)]*qtoken/i);
  });

  // Resume behavior across states.
  it('resume covers waiting/called/seated and excludes dead terminals', () => {
    expect(resumeCopyForState('WAITING').title).toContain('active ticket');
    expect(resumeCopyForState('CALLED').title).toContain('being called');
    expect(resumeCopyForState('SEATED').title).toContain('seated');
    for (const s of ['CANCELLED', 'NO_SHOW', 'EXPIRED']) {
      expect(isResumableTicketStatus(s)).toBe(false);
    }
  });

  // Called priority across pages.
  it('CALLED owns the hero; upsells step aside on ticket, menu, cart, order', () => {
    const ticket = read('app/q/[slug]/status/[token]/page.tsx');
    expect(ticket).toContain("status.status !== 'CALLED'");
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain("queueStatus === 'CALLED'");
    const order = read('app/q/[slug]/order/[token]/page.tsx');
    expect(order).toContain('queueCalled');
    expect(customerAttentionLevel('CALLED', null)).toBe('CALLED');
  });

  // Seated consistency.
  it('seated hides waiting metrics and keeps menu/order reachable', () => {
    expect(ticketStateMeta('SEATED').showWaitInfo).toBe(false);
    expect(read('components/customer/QueueTicketCard.tsx')).toContain('View Menu');
  });

  // Terminal consistency.
  it('terminals share one treatment: no wait info, explicit recovery', () => {
    for (const s of ['SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as const) {
      expect(ticketStateMeta(s).showWaitInfo).toBe(false);
      expect(isTicketTerminal(s)).toBe(true);
    }
  });

  // Order/queue separation.
  it('order and queue lifecycles never mutate each other from UI code', () => {
    for (const f of [
      'components/customer/CustomerMenuBrowser.tsx',
      'components/customer/CustomerOrdersCard.tsx',
      'app/q/[slug]/order/[token]/page.tsx',
    ]) {
      const code = read(f);
      expect(code).not.toContain('updateQueueStatus');
      expect(code).not.toContain('cancelQueuePublicAction');
    }
  });

  it('order status copy never leaks backend enum furniture', () => {
    for (const s of ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']) {
      const copy = customerOrderStatusCopy(s);
      expect(copy).not.toContain('DRAFT');
      expect(copy.length).toBeGreaterThan(5);
    }
  });

  // No token storage anywhere new.
  it('payment page stores nothing sensitive client-side', () => {
    const pay = read('app/q/[slug]/payment/[orderToken]/page.tsx');
    expect(pay).not.toContain('localStorage');
    expect(pay).not.toContain('sessionStorage');
    // Order token travels via route param + request bodies only.
    expect(pay).toContain('orderToken');
  });

  // No duplicate timers/subscriptions.
  it('customer surface keeps exactly the established realtime footprint', () => {
    const hook = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(hook.match(/setInterval/g)?.length ?? 0).toBe(1);
    // Payment page adds no realtime of its own.
    expect(read('app/q/[slug]/payment/[orderToken]/page.tsx')).not.toContain('realtime');
    expect(read('app/q/[slug]/payment/[orderToken]/page.tsx')).not.toContain('setInterval');
  });

  // Accessibility helpers.
  it('dialogs carry roles/labels; steppers are labelled', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('role="dialog"');
    expect(browser).toContain('aria-modal="true"');
    expect(browser).toContain('aria-label={`Decrease quantity of');
    expect(browser).toContain('aria-label={`Increase quantity of');
    expect(browser).toContain('aria-label="Search dishes"');
  });

  it('touch targets meet ~44px on key customer actions', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('h-11');
    expect(browser).toContain('w-11 h-11');
    // 32px stepper visuals carry an invisible 48px hit area.
    expect(browser).toContain("before:-inset-2 before:content-['']");
    const pay = read('app/q/[slug]/payment/[orderToken]/page.tsx');
    expect(pay).toContain('min-h-[44px]');
    expect(pay).toContain('min-h-[64px]');
  });

  // Dead code stays dead (deleted components must not be reintroduced).
  it('superseded customer components are gone', () => {
    for (const f of [
      'components/customer/ComplimentaryPourCard.tsx',
      'components/customer/PublicBottomNav.tsx',
      'components/customer/PublicMobileHeader.tsx',
      'components/customer/QueueStatusBanner.tsx',
    ]) {
      expect(existsSync(root(...f.split('/')))).toBe(false);
    }
  });

  // Copy hygiene: no technical terms in customer UI.
  it('customer UI avoids technical jargon', () => {
    const corpus = [
      read('components/customer/CustomerMenuBrowser.tsx'),
      read('components/customer/QueueTicketCard.tsx'),
      read('app/q/[slug]/payment/[orderToken]/page.tsx'),
      read('app/q/[slug]/order/[token]/page.tsx'),
    ].join('\n');
    expect(corpus).not.toMatch(/\bRPC\b/);
    expect(corpus).not.toMatch(/\bUUID\b/);
    expect(corpus).not.toMatch(/server error/i);
    expect(corpus).not.toMatch(/database/i);
  });

  // Currency uses restaurant config, never hardcoded display.
  it('prices render in restaurant currency via Intl', () => {
    const pay = read('app/q/[slug]/payment/[orderToken]/page.tsx');
    expect(pay).toContain('restaurant_currency');
    expect(pay).not.toContain('₹{');
    const order = read('app/q/[slug]/order/[token]/page.tsx');
    expect(order).toContain("restaurant.currency || 'INR'");
  });

  // Headers stay compact and consistent (restaurant + context + return).
  it('customer headers share one compact pattern', () => {
    const menu = read('app/q/[slug]/menu/page.tsx');
    expect(menu).toContain('RestaurantHeader');
    const pay = read('app/q/[slug]/payment/[orderToken]/page.tsx');
    expect(pay).toContain('Secure checkout');
    expect(pay).toContain('My Ticket');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { customerOrderStatusCopy } from '@/lib/customer-order-ux';

const root = (...p: string[]) => resolve(__dirname, '../../src', ...p);
const read = (p: string) => readFileSync(root(...p.split('/')), 'utf8');

describe('Phase 4G: menu + order-ahead contracts (unit)', () => {
  // A. Menu renders restaurant correctly.
  it('A. menu page renders restaurant identity + live item count', () => {
    const page = read('app/q/[slug]/menu/page.tsx');
    expect(page).toContain('RestaurantHeader');
    expect(page).toContain('Food Menu');
    expect(page).toContain('items • Live');
  });

  // B. Categories render correctly.
  it('B. category navigation derives from configured categories only', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('categories.map((cat)');
    expect(browser).not.toContain('Starters');
    expect(browser).not.toContain('Mains');
  });

  // C. Available item is selectable.
  it('C. available items offer quick-add and detail paths', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('if (!item.available) return;');
    expect(browser).toContain('+ Add');
    expect(browser).toContain('openDetail(item)');
  });

  // D. Unavailable item is clearly unavailable.
  it('D. unavailable items show honest state, never a working Add', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('Unavailable');
    expect(browser).not.toContain('Out of Stock');
    expect(browser).toContain('disabled={!detailItem.available}');
  });

  // E. Item detail preserves authoritative price presentation.
  it('E. detail sheet shows price + confirmation disclaimer', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('role="dialog"');
    expect(browser).toContain('Details for');
    expect(browser).toContain('Price confirmed by the restaurant');
  });

  // F. Cart add/remove/quantity behavior.
  it('F. quantity stepper removes lines at zero, caps at 99', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('newQty > 0 ?');
    expect(browser).toContain('Math.min(99');
    expect(browser).toContain('maxLength={200}');
  });

  // G. Cart total is presentation only.
  it('G. client sends intent only; totals disclaimed as server-confirmed', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('Final price confirmed by the restaurant');
    // Payload carries ids + quantities + notes — never prices/totals.
    expect(browser).toMatch(/items: cart\.map\(\(i\) => \(\{\s*menuItemId:[^}]*quantity:[^}]*notes:/s);
    expect(browser).not.toMatch(/items: cart\.map\([^)]*price/);
  });

  // R. Queue context remains accessible from menu/cart.
  it('R. ticket shortcut present on menu header, cart drawer, and order page', () => {
    expect(read('app/q/[slug]/menu/page.tsx')).toContain('My Ticket');
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('My ticket →');
    expect(read('app/q/[slug]/order/[token]/page.tsx')).toContain('Back to My Ticket');
  });

  // S. Queue and order states remain separate.
  it('S. no cross-domain mutations between queue and order flows', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).not.toContain('updateQueueStatus');
    expect(browser).not.toContain('cancelQueue');
    const card = read('components/customer/CustomerOrdersCard.tsx');
    expect(card).not.toContain('updateQueueStatus');
  });

  // T. CANCELLED queue does not silently resurrect.
  it('T. cancelled queue tickets stay terminal in order-adjacent UI', () => {
    const svc = read('lib/services/queue-service.ts');
    expect(svc).toContain("'CANCELLED'");
    const api = read('app/api/customer/orders/route.ts');
    expect(api).not.toContain('WAITING');
  });

  // U. CALLED queue prioritizes return-to-restaurant over menu CTA.
  it('U. pre-order upsell hidden when CALLED; neutral Menu link retained', () => {
    const page = read('app/q/[slug]/status/[token]/page.tsx');
    expect(page).toContain("status.status !== 'CALLED'");
    // Top-bar Menu pill (secondary nav) is NOT gated on CALLED.
    expect(page).toContain('Menu');
  });

  // V. Order status customer copy is correct.
  it('V. lifecycle maps to spec copy, no internal codes', () => {
    expect(customerOrderStatusCopy('PLACED')).toContain('Order received');
    expect(customerOrderStatusCopy('CONFIRMED')).toContain('Restaurant confirmed your order');
    expect(customerOrderStatusCopy('PREPARING')).toContain('Your food is being prepared');
    expect(customerOrderStatusCopy('READY')).toContain('Your order is ready');
    expect(customerOrderStatusCopy('SERVED')).toContain('Enjoy your meal');
    expect(customerOrderStatusCopy('CANCELLED')).toContain('Order cancelled');
    expect(customerOrderStatusCopy('WEIRD' as never)).not.toContain('WEIRD');
  });

  // W. Notifications are not duplicated.
  it('W. order notifications bind idempotency to the source outbox event', () => {
    const svc = read('lib/services/notification-service.ts');
    expect(svc).toContain('notifPayload.idempotencyKey = event.id');
    const provider = read('lib/notifications/providers/in-app-provider.ts');
    expect(provider).toContain('23505');
    expect(provider).toContain('idempotency_key');
  });

  // X. No raw tokens in storage/logs.
  it('X. cart persistence stores lines only — never tokens or secrets', () => {
    const browser = read('components/customer/CustomerMenuBrowser.tsx');
    expect(browser).toContain('sessionStorage.setItem(cartKey, JSON.stringify(cart))');
    expect(browser).not.toMatch(/sessionStorage\.setItem\([^)]*[Tt]oken/);
    // CartItem shape carries no credential fields.
    expect(browser).toMatch(/interface CartItem \{[^}]*menuItemId[^}]*name[^}]*price[^}]*quantity[^}]*notes/s);
    expect(browser).not.toMatch(/interface CartItem \{[^}]*[Tt]oken[^}]*\}/);
    // Order page never logs tokens.
    const orderPage = read('app/q/[slug]/order/[token]/page.tsx');
    expect(orderPage).not.toMatch(/console\.(log|info|warn|error)/);
  });

  // Y (contract). Payment handoff retains Phase 3D authorization.
  it('Y. payment intent requires orderToken; UUID alone is insufficient', () => {
    const route = read('app/api/payments/intent/route.ts');
    expect(route).toContain('Missing required parameters: orderToken, paymentMethod');
    expect(route).toContain('authorizeCustomerOrder');
  });

  // Z (contract). Invalid authorization is generic.
  it('Z. unknown order credentials yield generic 404', () => {
    const route = read('app/api/payments/intent/route.ts');
    expect(route).toContain('Order not found.');
  });
});

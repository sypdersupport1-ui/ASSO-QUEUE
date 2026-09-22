import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = (...p: string[]) => resolve(__dirname, '../../src', ...p);
const read = (p: string) => readFileSync(root(...p.split('/')), 'utf8');

describe('Customer Menu Pre-Order Flow & Admin Reflection (unit)', () => {
  it('A. OrderService touches queue_entries.updated_at on customer order creation', () => {
    const orderService = read('lib/services/order-service.ts');
    expect(orderService).toContain('// 7b. Touch queue_entries.updated_at to trigger real-time updates on staff dashboard');
    expect(orderService).toContain(".from('queue_entries')");
    expect(orderService).toContain(".update({ updated_at: new Date().toISOString() })");
    expect(orderService).toContain(".eq('id', validated.queueEntryId)");
  });

  it('B. LiveQueueFeedClient displays breakdown pill for both Dine-In pre-orders and Takeaway orders', () => {
    const liveQueueFeed = read('components/dashboard/LiveQueueFeedClient.tsx');
    expect(liveQueueFeed).toContain('{(linkedOrder || isTakeaway) && (');
    expect(liveQueueFeed).toContain("isTakeaway ? '🛍️ TAKEAWAY ORDER' : '🍽️ PRE-ORDERED DISHES'");
  });

  it('C. DashboardClient displays PRE-ORDERED badge on guest queue card', () => {
    const dashboardClient = read('components/dashboard/DashboardClient.tsx');
    expect(dashboardClient).toContain('const hasPreOrder = anyEntry.pre_order_amount && anyEntry.pre_order_amount > 0;');
    expect(dashboardClient).toContain('{hasPreOrder && (');
    expect(dashboardClient).toContain('<span>🍽️</span> PRE-ORDERED');
  });
});

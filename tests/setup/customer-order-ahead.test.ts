import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/**
 * Phase 4G live order-ahead verification (server-authoritative behavior).
 *
 * Uses a DEDICATED fixture restaurant (fixed id, created + removed by this
 * file) so parallel suites wiping shared fixtures (e.g. phase3a) can never
 * delete our queue entries mid-run. afterAll deletes the restaurant row;
 * ON DELETE CASCADE removes every child row. Creating PLACED orders never
 * touches inventory (deduction happens only on CONFIRMED) and no
 * worker/notification delivery runs here.
 */
describe('Phase 4G: server-authoritative order-ahead (live)', () => {
  // Dedicated fixture id — referenced by no other suite.
  const RID = 'c0000000-0000-4000-c000-000000000040';
  const OTHER_RID = '367cef4e-d63e-49e1-bc59-e484ed8e6d3a'; // Love Cafe (read-only reference)

  let client: import('pg').Client | null = null;
  let categoryId = '';
  let itemA = '';
  let itemB = '';
  let entryA = '';
  let entryB = '';
  let tokenA = '';
  let tokenB = '';
  const orderIds: string[] = [];

  const qtoken = () => `qtoken_${randomBytes(32).toString('hex')}`;
  const qhash = (t: string) => createHash('sha256').update(t).digest('hex');

  beforeAll(async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    client = c;

    await c.query(
      `INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status)
       VALUES ($1, 'Phase 4G Order Ahead', 'phase4g-order-ahead', true, 100, 1, 20, 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET queue_enabled = true, status = 'ACTIVE'`,
      [RID]
    );

    const cat = await c.query(
      `INSERT INTO public.menu_categories (restaurant_id, name, active) VALUES ($1, '4G QA Mains', true) RETURNING id`,
      [RID]
    );
    categoryId = cat.rows[0].id;
    const a = await c.query(
      `INSERT INTO public.menu_items (restaurant_id, category_id, name, price, active, available) VALUES ($1, $2, '4G QA Biryani', 120.00, true, true) RETURNING id`,
      [RID, categoryId]
    );
    itemA = a.rows[0].id;
    const b = await c.query(
      `INSERT INTO public.menu_items (restaurant_id, category_id, name, price, active, available) VALUES ($1, $2, '4G QA Naan', 80.00, true, true) RETURNING id`,
      [RID, categoryId]
    );
    itemB = b.rows[0].id;

    tokenA = qtoken();
    tokenB = qtoken();
    const ea = await c.query('SELECT * FROM public.join_queue_atomic($1, $2, NULL, 2, $3)', [RID, '4G QA Alice', qhash(tokenA)]);
    const eb = await c.query('SELECT * FROM public.join_queue_atomic($1, $2, NULL, 2, $3)', [RID, '4G QA Bob', qhash(tokenB)]);
    entryA = ea.rows[0].id;
    entryB = eb.rows[0].id;
  });

  afterAll(async () => {
    if (!client) return;
    const c = client as unknown as import('pg').Client;
    try {
      // Single restaurant DELETE cascades to all fixture children.
      await c.query('DELETE FROM public.restaurants WHERE id = $1', [RID]).catch(() => undefined);
    } finally {
      await c.end();
    }
  });

  // H. Server authoritative price wins (client cannot override).
  it('H. forged client price is ignored; DB price decides the total', async () => {
    const { OrderService } = await import('@/lib/services/order-service');
    const res = await OrderService.createCustomerOrder({
      restaurantId: RID,
      queueEntryId: entryA,
      idempotencyKey: `4g-h-${Date.now()}`,
      // @ts-expect-error forged fields must be stripped, not honored
      items: [{ menuItemId: itemA, quantity: 2, price: 1, total: 2 }],
    });
    orderIds.push(res.order.id);
    expect(Number(res.order.total)).toBe(240);
  });

  // N + O. Idempotent creation: replay returns the same order, single row.
  it('N/O. same idempotency key replays one order, raw token issued once', async () => {
    const { OrderService } = await import('@/lib/services/order-service');
    const key = `4g-n-${Date.now()}`;
    const first = await OrderService.createCustomerOrder({
      restaurantId: RID,
      queueEntryId: entryA,
      idempotencyKey: key,
      items: [{ menuItemId: itemB, quantity: 1 }],
    });
    orderIds.push(first.order.id);
    expect(first.rawToken).toMatch(/^qtoken_/);
    const replay = await OrderService.createCustomerOrder({
      restaurantId: RID,
      queueEntryId: entryA,
      idempotencyKey: key,
      items: [{ menuItemId: itemB, quantity: 1 }],
    });
    expect(replay.order.id).toBe(first.order.id);
    expect(replay.rawToken).toBe('');
    const { createAdminClient } = await import('@/lib/db/supabase/admin');
    const { count } = await createAdminClient().from('orders').select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  // P. Item becoming unavailable before submit is rejected safely.
  it('P. unavailable item rejected with customer-safe error', async () => {
    const c = (client as unknown as import('pg').Client);
    await c.query('UPDATE public.menu_items SET available = false WHERE id = $1', [itemB]);
    const { OrderService } = await import('@/lib/services/order-service');
    await expect(
      OrderService.createCustomerOrder({
        restaurantId: RID,
        queueEntryId: entryA,
        idempotencyKey: `4g-p-${Date.now()}`,
        items: [{ menuItemId: itemB, quantity: 1 }],
      })
    ).rejects.toThrow();
    await c.query('UPDATE public.menu_items SET available = true WHERE id = $1', [itemB]);
  });

  // Q. Price changing before submit uses the fresh server price.
  it('Q. mid-browse price change charges the new authoritative price', async () => {
    const c = (client as unknown as import('pg').Client);
    await c.query('UPDATE public.menu_items SET price = 150.00 WHERE id = $1', [itemA]);
    const { OrderService } = await import('@/lib/services/order-service');
    const res = await OrderService.createCustomerOrder({
      restaurantId: RID,
      queueEntryId: entryA,
      idempotencyKey: `4g-q-${Date.now()}`,
      items: [{ menuItemId: itemA, quantity: 1 }],
    });
    orderIds.push(res.order.id);
    expect(Number(res.order.total)).toBe(150);
    await c.query('UPDATE public.menu_items SET price = 120.00 WHERE id = $1', [itemA]);
  });

  // I/J/K. Token-bound order ownership at the customer action layer.
  it('I. entry from another restaurant is rejected', async () => {
    const { createCustomerOrderAction } = await import('@/app/dashboard/actions');
    await expect(
      createCustomerOrderAction({
        restaurantId: OTHER_RID,
        queueEntryId: entryA,
        queueToken: tokenA,
        idempotencyKey: `4g-i-${Date.now()}`,
        items: [{ menuItemId: itemA, quantity: 1 }],
      })
    ).rejects.toThrow(/authorization/i);
  });

  it('J. mismatched queue token cannot claim an entry', async () => {
    const { createCustomerOrderAction } = await import('@/app/dashboard/actions');
    await expect(
      createCustomerOrderAction({
        restaurantId: RID,
        queueEntryId: entryA,
        queueToken: tokenB,
        idempotencyKey: `4g-j-${Date.now()}`,
        items: [{ menuItemId: itemA, quantity: 1 }],
      })
    ).rejects.toThrow(/authorization/i);
  });

  it('K. entry claimed without any token is rejected', async () => {
    const { createCustomerOrderAction } = await import('@/app/dashboard/actions');
    await expect(
      createCustomerOrderAction({
        restaurantId: RID,
        queueEntryId: entryA,
        idempotencyKey: `4g-k-${Date.now()}`,
        items: [{ menuItemId: itemA, quantity: 1 }],
      })
    ).rejects.toThrow(/authorization/i);
  });

  // L. Another customer's order is unreadable without its token.
  it('L. unguessable order token gates order retrieval', async () => {
    const { OrderService } = await import('@/lib/services/order-service');
    expect(await OrderService.getCustomerOrderStateByToken(`qtoken_${'f'.repeat(64)}`)).toBeNull();
    expect(await OrderService.getCustomerOrderStateByToken('')).toBeNull();
    const res = await OrderService.createCustomerOrder({
      restaurantId: RID,
      queueEntryId: entryB,
      idempotencyKey: `4g-l-${Date.now()}`,
      items: [{ menuItemId: itemB, quantity: 1 }],
    });
    orderIds.push(res.order.id);
    const seen = await OrderService.getCustomerOrderStateByToken(res.rawToken);
    expect(seen?.orderId).toBe(res.order.id);
  });

  // S. Cancelling the order leaves the queue untouched.
  it('S. order cancel never cascades to the queue entry', async () => {
    const { OrderService } = await import('@/lib/services/order-service');
    const res = await OrderService.createCustomerOrder({
      restaurantId: RID,
      queueEntryId: entryB,
      idempotencyKey: `4g-s-${Date.now()}`,
      items: [{ menuItemId: itemB, quantity: 1 }],
    });
    orderIds.push(res.order.id);
    await OrderService.updateOrderStatus({ orderId: res.order.id, targetStatus: 'CANCELLED', restaurantId: RID });
    const c = (client as unknown as import('pg').Client);
    const entry = (await c.query('SELECT status FROM public.queue_entries WHERE id = $1', [entryB])).rows[0];
    expect(entry.status).toBe('WAITING');
  });

  // Y (live). Payment intent without the order credential is refused.
  it('Y. intent without orderToken is rejected (UUID alone insufficient)', async () => {
    const { POST } = await import('@/app/api/payments/intent/route');
    const { NextRequest } = await import('next/server');
    const noToken = await POST(new NextRequest('http://localhost/api/payments/intent', {
      method: 'POST',
      body: JSON.stringify({ orderId: '11111111-1111-4111-a111-111111111111', paymentMethod: 'ONLINE' }),
    }));
    expect(noToken.status).toBe(400);
    const body = await noToken.json();
    expect(JSON.stringify(body)).toContain('orderToken');
  });
});

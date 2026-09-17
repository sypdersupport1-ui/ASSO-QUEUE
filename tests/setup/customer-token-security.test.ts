import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { QueueService } from '@/lib/services/queue-service';
import { OrderService } from '@/lib/services/order-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { generateQueueToken, hashQueueToken } from '@/lib/utils/token-utils';
import { POST as cancelPOST } from '@/app/api/q/cancel/route';
import { GET as statusGET } from '@/app/api/q/status/route';
import { GET as notificationsGET } from '@/app/api/customer/notifications/route';
import { GET as ordersGET } from '@/app/api/customer/orders/route';
import { resetEnvCacheForTesting } from '@/lib/config/env';

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;

const REST_A_ID = '9a9a9a9a-1111-4111-a111-111111111111';
const REST_B_ID = '9b9b9b9b-2222-4222-b222-222222222222';
const REST_A_SLUG = 'token-sec-alpha';
const REST_B_SLUG = 'token-sec-beta';

function postForm(url: string, fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request(url, { method: 'POST', body: form });
}

describe('Phase 3D: live customer-token attack suite (cross-tenant)', () => {
  let client: Client;
  let tokenA = '';
  let tokenB = '';
  let entryA = '';
  let entryB = '';
  let entryC = '';
  let orderToken = '';
  let orderId = '';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live token security tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status)
       VALUES ($1, 'Token Sec Alpha', $2, true, 100, 1, 20, 'ACTIVE'),
              ($3, 'Token Sec Beta', $4, true, 100, 1, 20, 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, queue_enabled = true, status = 'ACTIVE'`,
      [REST_A_ID, REST_A_SLUG, REST_B_ID, REST_B_SLUG]
    );
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2)`, [
      REST_A_ID,
      REST_B_ID,
    ]);

    const joinA = await QueueService.joinQueue({
      restaurantId: REST_A_ID,
      customerName: 'Victim Alpha',
      customerPhone: '9000000001',
      partySize: 2,
    });
    tokenA = joinA.rawToken;
    entryA = joinA.entry.id;

    const joinB = await QueueService.joinQueue({
      restaurantId: REST_B_ID,
      customerName: 'Victim Beta',
      customerPhone: '9000000002',
      partySize: 3,
    });
    tokenB = joinB.rawToken;
    entryB = joinB.entry.id;

    const joinC = await QueueService.joinQueue({
      restaurantId: REST_A_ID,
      customerName: 'Race Gamma',
      partySize: 1,
    });
    entryC = joinC.entry.id;

    // Order bound to entry A, authenticated by its own order token.
    orderToken = generateQueueToken();
    const inserted = await client.query(
      `INSERT INTO public.orders
         (restaurant_id, queue_entry_id, order_number, status, payment_status,
          subtotal, tax, total, order_token, order_token_hash, customer_name, customer_phone)
       VALUES ($1, $2, 'ORD-SEC-1', 'PLACED', 'UNPAID', 100, 0, 100, NULL, $3, 'Victim Alpha', '9000000001')
       RETURNING id`,
      [REST_A_ID, entryA, hashQueueToken(orderToken)]
    );
    orderId = inserted.rows[0].id;

    // Notifications for both customers.
    await client.query(
      `INSERT INTO public.notifications
         (restaurant_id, queue_entry_id, channel, notification_type, message, status)
       VALUES ($1, $2, 'IN_APP', 'QUEUE_JOINED', 'alpha-msg', 'DELIVERED'),
              ($3, $4, 'IN_APP', 'QUEUE_JOINED', 'beta-msg', 'DELIVERED')`,
      [REST_A_ID, entryA, REST_B_ID, entryB]
    );

    expect(tokenA && tokenB && entryA && entryB && entryC && orderId).toBeTruthy();
  });

  afterAll(async () => {
    try {
      await client.query(`DELETE FROM public.notifications WHERE restaurant_id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
      await client.query(`DELETE FROM public.orders WHERE restaurant_id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
      await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
      await client.query(`DELETE FROM public.restaurants WHERE id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
    } finally {
      if (client) await client.end();
    }
  });

  it('A. valid token resolves its own entry; B. cannot reach the other entry', async () => {
    const statusA = await QueueService.getQueueStatusByToken(tokenA);
    expect(statusA).not.toBeNull();
    expect(statusA!.entryId).toBe(entryA);
    expect(statusA!.restaurantId).toBe(REST_A_ID);
    expect(statusA!.entryId).not.toBe(entryB);
  });

  it('E–H. invalid, empty, malformed, and 1-char-modified tokens all fail generically', async () => {
    expect(await QueueService.getQueueStatusByToken('')).toBeNull();
    expect(await QueueService.getQueueStatusByToken('not-a-token')).toBeNull();
    expect(await QueueService.getQueueStatusByToken('qtoken_short')).toBeNull();
    const tampered = tokenA.slice(0, -1) + (tokenA.endsWith('a') ? 'b' : 'a');
    expect(await QueueService.getQueueStatusByToken(tampered)).toBeNull();

    const res = await statusGET(
      new Request(`http://test/api/q/status?token=${tampered}`)
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid or expired token.');
  });

  it('C. valid token + tampered restaurant slug fails with a generic response (no leak)', async () => {
    const res = await cancelPOST(
      postForm('http://test/api/q/cancel', { token: tokenA, restaurantSlug: REST_B_SLUG })
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid or expired token.');
    // Attacker's entry is untouched.
    const { rows } = await client.query(
      `SELECT status FROM public.queue_entries WHERE id = $1`,
      [entryA]
    );
    expect(rows[0].status).toBe('WAITING');
  });

  it('D. injected queue_entry_id field is ignored, never trusted', async () => {
    const res = await cancelPOST(
      postForm('http://test/api/q/cancel', {
        token: tokenA,
        restaurantSlug: REST_A_SLUG,
        queueEntryId: entryB,
        entryId: entryB,
      })
    );
    expect(res.status).toBe(200);
    // B (other tenant) untouched; A (token-derived) cancelled.
    const { rows } = await client.query(
      `SELECT id, status FROM public.queue_entries WHERE id = ANY($1)`,
      [[entryA, entryB]]
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[entryA]).toBe('CANCELLED');
    expect(byId[entryB]).toBe('WAITING');
  });

  it('M. notification endpoint cannot enumerate another customer', async () => {
    const resA = await notificationsGET(
      new Request(`http://test/api/customer/notifications?token=${tokenA}`) as never
    );
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as { notifications: Array<{ message: string }> };
    expect(bodyA.notifications.map((n) => n.message)).toEqual(['alpha-msg']);

    const resB = await notificationsGET(
      new Request(`http://test/api/customer/notifications?token=${tokenB}`) as never
    );
    const bodyB = (await resB.json()) as { notifications: Array<{ message: string }> };
    expect(bodyB.notifications.map((n) => n.message)).toEqual(['beta-msg']);
  });

  it('N. cancel is isolated + idempotent replay writes exactly one event', async () => {
    // A was cancelled in the D test; replay must succeed harmlessly.
    const replay = await cancelPOST(
      postForm('http://test/api/q/cancel', { token: tokenA, restaurantSlug: REST_A_SLUG })
    );
    expect(replay.status).toBe(200);

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.queue_events
       WHERE queue_entry_id = $1 AND event_type LIKE '%CANCEL%'`,
      [entryA]
    );
    expect(rows[0].n).toBe(1);
  });

  it('O. concurrent double-cancel stays race-safe with a single transition', async () => {
    const [r1, r2] = await Promise.all([
      QueueService.updateQueueStatus({ entryId: entryC, newStatus: 'CANCELLED' }),
      QueueService.updateQueueStatus({ entryId: entryC, newStatus: 'CANCELLED' }),
    ]);
    expect(r1 && r2).toBeTruthy();
    const { rows } = await client.query(
      `SELECT status FROM public.queue_entries WHERE id = $1`,
      [entryC]
    );
    expect(rows[0].status).toBe('CANCELLED');
    const ev = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.queue_events
       WHERE queue_entry_id = $1 AND event_type LIKE '%CANCEL%'`,
      [entryC]
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('P–T. sequential ids, display numbers, phones, slugs authorize nothing', async () => {
    const { rows } = await client.query(
      `SELECT queue_number, display_number, customer_phone FROM public.queue_entries WHERE id = $1`,
      [entryA]
    );
    const { queue_number: qn, display_number: dn, customer_phone: ph } = rows[0];

    expect(await QueueService.getQueueStatusByToken(String(qn))).toBeNull();
    if (dn) expect(await QueueService.getQueueStatusByToken(String(dn))).toBeNull();
    expect(await QueueService.getQueueStatusByToken(String(ph))).toBeNull();
    expect(await QueueService.getQueueStatusByToken(REST_A_ID)).toBeNull();
    expect(await QueueService.getQueueStatusByToken(entryA)).toBeNull();

    // Public restaurant lookup exposes no entry/token material.
    const pub = await PublicRestaurantService.getPublicRestaurantBySlug(REST_A_SLUG);
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toMatch(/qtoken_|token_hash/i);
    expect(pub).not.toHaveProperty('token_hash');
  });

  it('Y/Z. order and queue tokens are not interchangeable', async () => {
    // Queue token presented as an order token -> nothing.
    expect(await OrderService.getCustomerOrderStateByToken(tokenA)).toBeNull();
    const orderRes = await ordersGET(
      new Request(`http://test/api/customer/orders?token=${tokenA}&slug=${REST_A_SLUG}`)
    );
    expect(orderRes.status).toBe(404);

    // Order token presented as a queue token -> nothing.
    expect(await QueueService.getQueueStatusByToken(orderToken)).toBeNull();
  });

  it('X. order response is minimized (no phone, no raw token, cache-private)', async () => {
    const res = await ordersGET(
      new Request(`http://test/api/customer/orders?token=${orderToken}&slug=${REST_A_SLUG}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as { order: Record<string, unknown> };
    expect(body.order.order_number).toBe('ORD-SEC-1');
    expect(body.order).not.toHaveProperty('customer_phone');
    expect(body.order).not.toHaveProperty('order_token');
    expect(body.order).not.toHaveProperty('order_token_hash');
    expect(JSON.stringify(body)).not.toMatch(/qtoken_|9000000001/);
  });

  it('terminal tickets remain viewable (lifetime decision) but cannot transition', async () => {
    const statusRes = await statusGET(
      new Request(`http://test/api/q/status?token=${tokenA}`)
    );
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as {
      status: { status: string };
    };
    expect(body.status.status).toBe('CANCELLED');

    await expect(
      QueueService.updateQueueStatus({ entryId: entryA, newStatus: 'CALLED' })
    ).rejects.toThrow();
  });
});

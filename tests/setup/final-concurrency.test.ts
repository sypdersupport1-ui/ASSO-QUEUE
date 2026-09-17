import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { QueueService } from '@/lib/services/queue-service';
import { OrderService } from '@/lib/services/order-service';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { resetEnvCacheForTesting } from '@/lib/config/env';

// Race tests exercise DB atomicity, not authz: bypass the app-layer permission
// check exactly like queue-ops-seating does. (RLS/RPC-grant behavior is proven
// separately in rpc-least-privilege.test.ts with real JWTs.)
vi.mock('@/lib/services/authorization-service', () => ({
  AuthorizationService: {
    requirePermission: vi.fn().mockImplementation(async (options: any) => ({
      userId: options.userId || '00000000-0000-0000-0000-000000000001',
      role: 'RESTAURANT_ADMIN',
      restaurantId: options.restaurantId || 'test-restaurant',
      membershipId: 'test-membership',
    })),
    hasPermission: vi.fn().mockResolvedValue(true),
  },
}));

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;
// Real auth user id (satisfies queue_events.actor_user_id FK); the
// AuthorizationService mock returns it for every permission check.
let ACTOR = '00000000-0000-0000-0000-000000000001';

const RACE_Q = 'c0c0c0c0-1111-4111-a111-111111111111';
const RACE_S = 'c1c1c1c1-2222-4222-b222-222222222222';
const RACE_O = 'c2c2c2c2-3333-4333-c333-333333333333';

/**
 * Phase 3E: final queue/order concurrency + bounded load smoke.
 * Every race asserts an atomic end-state: no duplicates, no over-capacity,
 * no double seating/occupancy, no impossible transitions, no lost updates.
 */
describe('Phase 3E: final concurrency + load smoke (live)', () => {
  let client: Client;
  let admin: ReturnType<typeof createAdminClient>;
  let seatTableA = '';
  let seatTableB = '';

  async function joinQuiet(restaurantId: string, name: string, phone: string) {
    return QueueService.joinQueue({ restaurantId, customerName: name, customerPhone: phone, partySize: 2 });
  }

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live concurrency tests');
    }
    client = new Client({ connectionString });
    await client.connect();
    admin = createAdminClient();

    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status, auto_expire_called)
       VALUES
         ($1, 'Race Capacity', 'race-cap-9e', true, 3, 1, 20, 'ACTIVE', false),
         ($2, 'Race Seating', 'race-seat-9e', true, 100, 1, 20, 'ACTIVE', true),
         ($3, 'Race Orders', 'race-ord-9e', true, 100, 1, 20, 'ACTIVE', false)
       ON CONFLICT (id) DO UPDATE SET queue_enabled = true, max_queue_capacity = CASE WHEN public.restaurants.id = $1 THEN 3 ELSE 100 END, status = 'ACTIVE', auto_expire_called = CASE WHEN public.restaurants.id = $2 THEN true ELSE false END`,
      [RACE_Q, RACE_S, RACE_O]
    );
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2, $3)`, [
      RACE_Q,
      RACE_S,
      RACE_O,
    ]);

    // Seed a real actor (auth user + profile) so event/audit FKs hold.
    const adminClient = createAdminClient();
    const actorEmail = `race-actor-${Date.now()}@example.com`;
    const { data: createdActor } = await adminClient.auth.admin.createUser({
      email: actorEmail,
      password: 'Test1234!',
      email_confirm: true,
    });
    ACTOR = createdActor.user!.id;
    await client.query(
      `INSERT INTO public.user_profiles (id, display_name, email)
       VALUES ($1, 'Race Actor', $2) ON CONFLICT (id) DO NOTHING`,
      [ACTOR, actorEmail]
    );
    // The seat RPC verifies has_restaurant_role() internally (defense in
    // depth), so the actor needs a real membership like production staff.
    await client.query(
      `INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
       VALUES ($1, $2, 'STAFF', 'ACTIVE')
       ON CONFLICT (user_id, restaurant_id, role) DO UPDATE SET status = 'ACTIVE'`,
      [ACTOR, RACE_S]
    );

    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'RT-A', 4, 'AVAILABLE'), ($1, 'RT-B', 4, 'AVAILABLE')
       RETURNING id, table_number`,
      [RACE_S]
    );
    for (const row of t.rows) {
      if (row.table_number === 'RT-A') seatTableA = row.id;
      else seatTableB = row.id;
    }
    expect(seatTableA && seatTableB).toBeTruthy();
  });

  afterAll(async () => {
    try {
      const adminClient = createAdminClient();
      await adminClient.auth.admin.deleteUser(ACTOR).catch(() => {});
      await client.query(`DELETE FROM public.user_profiles WHERE id = $1`, [ACTOR]);
      await client.query(`DELETE FROM public.payments WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.orders WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.order_items WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.inventory_movements WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.inventory_items WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.restaurant_tables WHERE restaurant_id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
      await client.query(`DELETE FROM public.restaurants WHERE id IN ($1, $2, $3)`, [
        RACE_Q,
        RACE_S,
        RACE_O,
      ]);
    } finally {
      if (client) await client.end();
    }
  });

  it('A/B. burst joins beyond capacity: exactly at cap, rest rejected, no dupes', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        joinQuiet(RACE_Q, `Burst ${i}`, `910000000${i}`)
      )
    );
    const ok = attempts.filter((r) => r.status === 'fulfilled');
    const failed = attempts.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(3);
    expect(failed.length).toBe(3);
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason?.message).toMatch(/QUEUE_FULL/i);
    }
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.queue_entries
       WHERE restaurant_id = $1 AND status IN ('WAITING','NOTIFIED','CALLED')`,
      [RACE_Q]
    );
    expect(rows[0].n).toBe(3);
  });

  it('D. double call converges idempotently with a single transition', async () => {
    const join = await joinQuiet(RACE_S, 'Double Call', '9200000001');
    const [r1, r2] = await Promise.all([
      QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CALLED', actorUserId: ACTOR }),
      QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CALLED', actorUserId: ACTOR }),
    ]);
    expect(r1 && r2).toBeTruthy();
    const { rows } = await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [
      join.entry.id,
    ]);
    expect(rows[0].status).toBe('CALLED');
  });

  it('C. double seat to different tables: exactly one wins', async () => {
    const join = await joinQuiet(RACE_S, 'Double Seat', '9200000002');
    const results = await Promise.allSettled([
      QueueService.seatQueueEntry(join.entry.id, seatTableA, ACTOR),
      QueueService.seatQueueEntry(join.entry.id, seatTableB, ACTOR),
    ]);
    const wins = results.filter((r) => r.status === 'fulfilled');
    expect(wins.length).toBe(1);
    const { rows } = await client.query(
      `SELECT q.status, q.seated_table_id, t.status AS table_status
       FROM public.queue_entries q JOIN public.restaurant_tables t ON t.id = q.seated_table_id
       WHERE q.id = $1`,
      [join.entry.id]
    );
    expect(rows[0].status).toBe('SEATED');
    expect(rows[0].table_status).toBe('OCCUPIED');
  });

  it('F. seat vs cancel: exactly one terminal outcome, loser fails cleanly', async () => {
    const join = await joinQuiet(RACE_S, 'Seat Cancel', '9200000003');
    await QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CALLED', actorUserId: ACTOR });
    // Fresh table so table contention cannot decide the race.
    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'RT-F', 4, 'AVAILABLE') RETURNING id`,
      [RACE_S]
    );
    const results = await Promise.allSettled([
      QueueService.seatQueueEntry(join.entry.id, t.rows[0].id, ACTOR),
      QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CANCELLED', actorUserId: ACTOR }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const { rows } = await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [
      join.entry.id,
    ]);
    expect(['SEATED', 'CANCELLED']).toContain(rows[0].status);
  });

  it('G. seat vs no-show: exactly one terminal outcome', async () => {
    const join = await joinQuiet(RACE_S, 'Seat Noshow', '9200000004');
    await QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CALLED', actorUserId: ACTOR });
    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'RT-G', 4, 'AVAILABLE') RETURNING id`,
      [RACE_S]
    );
    const results = await Promise.allSettled([
      QueueService.seatQueueEntry(join.entry.id, t.rows[0].id, ACTOR),
      QueueService.updateQueueStatus({
        entryId: join.entry.id,
        newStatus: 'NO_SHOW',
        actorUserId: ACTOR,
        reason: 'STAFF_MARKED_NO_SHOW',
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const { rows } = await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [
      join.entry.id,
    ]);
    expect(['SEATED', 'NO_SHOW']).toContain(rows[0].status);
  });

  it('H. two guests, one table: single occupancy, loser fails', async () => {
    const j1 = await joinQuiet(RACE_S, 'Table Race 1', '9200000005');
    const j2 = await joinQuiet(RACE_S, 'Table Race 2', '9200000006');
    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'RT-H', 6, 'AVAILABLE') RETURNING id`,
      [RACE_S]
    );
    const tableId = t.rows[0].id as string;
    const results = await Promise.allSettled([
      QueueService.seatQueueEntry(j1.entry.id, tableId, ACTOR),
      QueueService.seatQueueEntry(j2.entry.id, tableId, ACTOR),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.queue_entries
       WHERE seated_table_id = $1 AND status = 'SEATED'`,
      [tableId]
    );
    expect(rows[0].n).toBe(1);
    const tst = await client.query(`SELECT status FROM public.restaurant_tables WHERE id = $1`, [
      tableId,
    ]);
    expect(tst.rows[0].status).toBe('OCCUPIED');
  });

  it('I. table flipped to CLEANING mid-seat keeps state consistent', async () => {
    const join = await joinQuiet(RACE_S, 'Flip Seat', '9200000007');
    await QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CALLED', actorUserId: ACTOR });
    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'RT-I', 4, 'AVAILABLE') RETURNING id`,
      [RACE_S]
    );
    const tableId = t.rows[0].id as string;
    const results = await Promise.allSettled([
      QueueService.seatQueueEntry(join.entry.id, tableId, ACTOR),
      client.query(`UPDATE public.restaurant_tables SET status = 'CLEANING' WHERE id = $1`, [tableId]),
    ]);
    void results;
    const q = await client.query(
      `SELECT q.status AS qs, q.seated_table_id, t.status AS ts
       FROM public.queue_entries q LEFT JOIN public.restaurant_tables t ON t.id = $2
       WHERE q.id = $1`,
      [join.entry.id, tableId]
    );
    const row = q.rows[0];
    const consistent =
      (row.qs === 'SEATED' && row.seated_table_id === tableId) ||
      (row.qs !== 'SEATED' && row.ts !== 'OCCUPIED');
    expect(consistent).toBe(true);
  });

  it('E. backdated CALLED + seat vs auto-expire: single valid outcome', async () => {
    const join = await joinQuiet(RACE_S, 'Expire Race', '9200000008');
    await QueueService.updateQueueStatus({ entryId: join.entry.id, newStatus: 'CALLED', actorUserId: ACTOR });
    await client.query(`UPDATE public.queue_entries SET called_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`, [
      join.entry.id,
    ]);
    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'RT-E', 4, 'AVAILABLE') RETURNING id`,
      [RACE_S]
    );
    const results = await Promise.allSettled([
      QueueService.seatQueueEntry(join.entry.id, t.rows[0].id, ACTOR),
      QueueService.expireOverdueCalledEntries(50),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const { rows } = await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [
      join.entry.id,
    ]);
    expect(['SEATED', 'NO_SHOW']).toContain(rows[0].status);
  });

  it('J/K. closed queue rejects joins; reopened queue accepts', async () => {
    await admin.from('restaurants').update({ queue_operating_state: 'CLOSED' }).eq('id', RACE_Q);
    // Clear capacity-race rows so CLOSED (not FULL) decides.
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id = $1`, [RACE_Q]);
    const closed = await Promise.allSettled([
      joinQuiet(RACE_Q, 'Closed 1', '9300000001'),
      joinQuiet(RACE_Q, 'Closed 2', '9300000002'),
    ]);
    expect(closed.every((r) => r.status === 'rejected')).toBe(true);

    await admin.from('restaurants').update({ queue_operating_state: 'OPEN' }).eq('id', RACE_Q);
    const open = await joinQuiet(RACE_Q, 'Reopen 1', '9300000003');
    expect(open.entry.status).toBe('WAITING');
  });

  it('order confirm/cancel race: exactly one wins, no lost update', async () => {
    const ins = await client.query(
      `INSERT INTO public.orders (restaurant_id, order_number, status, payment_status, subtotal, tax, total)
       VALUES ($1, 'ORD-RACE-1', 'PLACED', 'UNPAID', 50, 0, 50) RETURNING id`,
      [RACE_O]
    );
    const orderId = ins.rows[0].id as string;
    const results = await Promise.allSettled([
      OrderService.updateOrderStatus({ orderId, targetStatus: 'CONFIRMED' }),
      OrderService.updateOrderStatus({ orderId, targetStatus: 'CANCELLED' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const { rows } = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
    expect(['CONFIRMED', 'CANCELLED']).toContain(rows[0].status);
    const ev = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.order_events WHERE order_id = $1 AND event_type IN ('ORDER_CONFIRMED','ORDER_CANCELLED')`,
      [orderId]
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('inventory double-deduct with one reference deducts exactly once', async () => {
    const item = await client.query(
      `INSERT INTO public.inventory_items (restaurant_id, name, unit, current_quantity)
       VALUES ($1, 'Race Flour', 'kg', 100) RETURNING id`,
      [RACE_O]
    );
    const itemId = item.rows[0].id as string;
    const refId = 'd0d0d0d0-1111-4111-a111-111111111111';
    const results = await Promise.allSettled([
      admin.rpc('deduct_inventory_atomic', {
        p_restaurant_id: RACE_O,
        p_inventory_item_id: itemId,
        p_quantity: 10,
        p_reference_type: 'ORDER_CONSUMPTION',
        p_reference_id: refId,
        p_reason: 'race',
        p_created_by: null,
      }),
      admin.rpc('deduct_inventory_atomic', {
        p_restaurant_id: RACE_O,
        p_inventory_item_id: itemId,
        p_quantity: 10,
        p_reference_type: 'ORDER_CONSUMPTION',
        p_reference_id: refId,
        p_reason: 'race',
        p_created_by: null,
      }),
    ]);
    void results;
    const stock = await client.query(`SELECT current_quantity FROM public.inventory_items WHERE id = $1`, [
      itemId,
    ]);
    expect(Number(stock.rows[0].current_quantity)).toBe(90);
    const moves = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.inventory_movements
       WHERE inventory_item_id = $1 AND movement_type = 'ORDER_CONSUMPTION' AND reference_id = $2`,
      [itemId, refId]
    );
    expect(moves.rows[0].n).toBe(1);
  });

  it('load smoke: 30-join burst on cap-5 stays bounded; 50 status reads all resolve', async () => {
    await client.query(
      `UPDATE public.restaurants SET max_queue_capacity = 5 WHERE id = $1`,
      [RACE_S]
    );
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id = $1`, [RACE_S]);
    const burst = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        QueueService.joinQueue({
          restaurantId: RACE_S,
          customerName: `Load ${i}`,
          customerPhone: `9400000${String(i).padStart(3, '0')}`,
          partySize: 1,
        })
      )
    );
    const ok = burst.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(5);
    for (const f of burst) {
      if (f.status === 'rejected') {
        expect(String(f.reason?.message || f.reason)).toMatch(/QUEUE_FULL|DUPLICATE/i);
      }
    }

    const sample = ok[0] as PromiseFulfilledResult<{ rawToken: string }>;
    const reads = await Promise.all(
      Array.from({ length: 50 }, () => QueueService.getQueueStatusByToken(sample.value.rawToken))
    );
    expect(reads.every((r) => r !== null)).toBe(true);
  });
});

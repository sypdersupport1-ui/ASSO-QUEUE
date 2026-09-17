import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import { createTableSchema, updateTableSchema } from '@/lib/services/table-service';
import { QueueService } from '@/lib/services/queue-service';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 4: Final Occupancy Integrity, Concurrency & Invariant Verification', () => {
  let client: Client;

  const SIMPLE_REST_ID = '88888888-8888-4888-8888-888888888881';
  const STRICT_REST_ID = '88888888-8888-4888-8888-888888888882';
  const ACTOR_ID = 'b0000000-0000-4000-b000-000000000088';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local');
    }
    client = new Client({ connectionString });
    await client.connect();

    // Ensure restaurants exist for Simple and Strict modes
    await client.query(`
      INSERT INTO public.restaurants (id, name, slug, seating_mode, status, queue_enabled)
      VALUES 
        ($1, 'Simple Mode Rest', 'simple-mode-verify', 'SIMPLE', 'ACTIVE', true),
        ($2, 'Strict Mode Rest', 'strict-mode-verify', 'STRICT', 'ACTIVE', true)
      ON CONFLICT (id) DO UPDATE SET 
        seating_mode = EXCLUDED.seating_mode,
        status = 'ACTIVE';
    `, [SIMPLE_REST_ID, STRICT_REST_ID]);

    // Ensure staff actor exists
    await client.query(`
      INSERT INTO auth.users (id, instance_id, email, aud, role)
      VALUES ($1, '00000000-0000-0000-0000-000000000000', 'seating-actor@queueflow.io', 'authenticated', 'authenticated')
      ON CONFLICT (id) DO NOTHING;
    `, [ACTOR_ID]);

    await client.query(`
      INSERT INTO public.user_profiles (id, display_name, email)
      VALUES ($1, 'Seating Actor', 'seating-actor@queueflow.io')
      ON CONFLICT (id) DO NOTHING;
    `, [ACTOR_ID]);

    await client.query(`
      INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
      VALUES 
        ($1, $2, 'STAFF', 'ACTIVE'),
        ($1, $3, 'STAFF', 'ACTIVE')
      ON CONFLICT (user_id, restaurant_id, role) DO UPDATE SET status = 'ACTIVE';
    `, [ACTOR_ID, SIMPLE_REST_ID, STRICT_REST_ID]);
  });

  afterAll(async () => {
    try {
      await client.query(`DELETE FROM public.active_seating_assignments WHERE restaurant_id IN ($1, $2)`, [SIMPLE_REST_ID, STRICT_REST_ID]);
      await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2)`, [SIMPLE_REST_ID, STRICT_REST_ID]);
      await client.query(`DELETE FROM public.restaurant_tables WHERE restaurant_id IN ($1, $2)`, [SIMPLE_REST_ID, STRICT_REST_ID]);
      await client.end();
    } catch {
      // ignore teardown errors
    }
  });

  // A. New 2-seat table starts 0/2
  it('A. New 2-seat table starts 0/2', async () => {
    const res = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-A-2', 2, 'AVAILABLE')
      RETURNING id, capacity, occupied_seats, free_seats;
    `, [SIMPLE_REST_ID]);
    const table = res.rows[0];
    expect(table.capacity).toBe(2);
    expect(table.occupied_seats).toBe(0);
    expect(table.free_seats).toBe(2);
  });

  // B. New 4-seat table starts 0/4
  it('B. New 4-seat table starts 0/4', async () => {
    const res = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-B-4', 4, 'AVAILABLE')
      RETURNING id, capacity, occupied_seats, free_seats;
    `, [SIMPLE_REST_ID]);
    const table = res.rows[0];
    expect(table.capacity).toBe(4);
    expect(table.occupied_seats).toBe(0);
    expect(table.free_seats).toBe(4);
  });

  // C. New 6-seat table starts 0/6
  it('C. New 6-seat table starts 0/6', async () => {
    const res = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-C-6', 6, 'AVAILABLE')
      RETURNING id, capacity, occupied_seats, free_seats;
    `, [SIMPLE_REST_ID]);
    const table = res.rows[0];
    expect(table.capacity).toBe(6);
    expect(table.occupied_seats).toBe(0);
    expect(table.free_seats).toBe(6);
  });

  // D. New 10-seat table starts 0/10
  it('D. New 10-seat table starts 0/10', async () => {
    const res = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-D-10', 10, 'AVAILABLE')
      RETURNING id, capacity, occupied_seats, free_seats;
    `, [SIMPLE_REST_ID]);
    const table = res.rows[0];
    expect(table.capacity).toBe(10);
    expect(table.occupied_seats).toBe(0);
    expect(table.free_seats).toBe(10);
  });

  // E. Occupancy never exceeds capacity
  it('E. Occupancy never exceeds capacity (rejected by constraint)', async () => {
    await expect(
      client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
        VALUES ($1, 'T-E-FAIL', 4, 5, 'OCCUPIED');
      `, [SIMPLE_REST_ID])
    ).rejects.toThrow();
  });

  // F. Free seats never become negative
  it('F. Free seats never become negative (rejected by constraint)', async () => {
    // Attempting occupancy greater than capacity on OCCUPIED table drives free_seats below 0
    await expect(
      client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
        VALUES ($1, 'T-F-FAIL', 4, 6, 'OCCUPIED');
      `, [SIMPLE_REST_ID])
    ).rejects.toThrow();
  });

  // G. free_seats always equals capacity - occupied_seats
  it('G. free_seats always equals capacity - occupied_seats', async () => {
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-G-INV', 6, 'AVAILABLE')
      RETURNING id, capacity, occupied_seats, free_seats;
    `, [SIMPLE_REST_ID]);
    const row = t.rows[0];
    expect(row.free_seats).toBe(row.capacity - row.occupied_seats);

    // Update capacity from 6 to 8: trigger synchronizes free_seats
    const updated = await client.query(`
      UPDATE public.restaurant_tables
      SET capacity = 8
      WHERE id = $1
      RETURNING capacity, occupied_seats, free_seats;
    `, [row.id]);
    expect(updated.rows[0].free_seats).toBe(8);
    expect(updated.rows[0].free_seats).toBe(updated.rows[0].capacity - updated.rows[0].occupied_seats);
  });

  // H. Simple mode cannot share occupied table
  it('H. Simple mode cannot share occupied table', async () => {
    // Create 6-seat table and manually set to OCCUPIED with 4 occupied, 2 free
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-H-SIMPLE', 6, 4, 'OCCUPIED')
      RETURNING id;
    `, [SIMPLE_REST_ID]);
    const tableId = t.rows[0].id;

    // Create a waiting queue entry with party_size = 2
    const q = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party Two Simple', 2, 'WAITING', 1, 1)
      RETURNING id;
    `, [SIMPLE_REST_ID]);
    const entryId = q.rows[0].id;

    // Attempt seating: in SIMPLE mode, occupied tables cannot be shared
    await expect(
      client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [entryId, tableId, ACTOR_ID])
    ).rejects.toThrow(/TABLE_NOT_AVAILABLE/);
  });

  // I. Strict mode can share available seats
  it('I. Strict mode can share available seats', async () => {
    // Create 6-seat table in STRICT mode with 4 occupied, 2 free
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-I-STRICT', 6, 4, 'OCCUPIED')
      RETURNING id;
    `, [STRICT_REST_ID]);
    const tableId = t.rows[0].id;

    // Create a waiting queue entry with party_size = 2
    const q = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party Two Strict', 2, 'WAITING', 101, 101)
      RETURNING id;
    `, [STRICT_REST_ID]);
    const entryId = q.rows[0].id;

    // Seating in STRICT mode succeeds on available free_seats
    const seatRes = await client.query(
      `SELECT public.seat_queue_entry_atomic($1, $2, $3)`,
      [entryId, tableId, ACTOR_ID]
    );
    expect(seatRes.rows[0].seat_queue_entry_atomic.success).toBe(true);

    const checkTable = await client.query(
      `SELECT capacity, occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`,
      [tableId]
    );
    expect(checkTable.rows[0].occupied_seats).toBe(6);
    expect(checkTable.rows[0].free_seats).toBe(0);
    expect(checkTable.rows[0].status).toBe('OCCUPIED');
  });

  // J. Shared table fills correctly and blocks further over-capacity seating
  it('J. Shared table fills correctly and blocks further seating when 0 free', async () => {
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-J-FULL', 4, 4, 'OCCUPIED')
      RETURNING id;
    `, [STRICT_REST_ID]);
    const tableId = t.rows[0].id;

    const q = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party Over', 1, 'WAITING', 102, 102)
      RETURNING id;
    `, [STRICT_REST_ID]);
    const entryId = q.rows[0].id;

    await expect(
      client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [entryId, tableId, ACTOR_ID])
    ).rejects.toThrow(/INSUFFICIENT_TABLE_CAPACITY/);
  });

  // K. Multi-table allocation sums correctly
  it('K. Multi-table allocation sums correctly', async () => {
    const t1 = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-K-1', 4, 'AVAILABLE')
      RETURNING id;
    `, [SIMPLE_REST_ID]);
    const t2 = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-K-2', 2, 'AVAILABLE')
      RETURNING id;
    `, [SIMPLE_REST_ID]);

    const q = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Multi Table Party', 6, 'WAITING', 201, 201)
      RETURNING id;
    `, [SIMPLE_REST_ID]);

    const res = await client.query(
      `SELECT public.seat_queue_entry_atomic($1, $2, $3, 6, $4)`,
      [q.rows[0].id, t1.rows[0].id, ACTOR_ID, [t2.rows[0].id]]
    );
    expect(res.rows[0].seat_queue_entry_atomic.success).toBe(true);

    const assigns = await client.query(`
      SELECT table_id, guests_allocated FROM public.active_seating_assignments
      WHERE queue_entry_id = $1 ORDER BY guests_allocated DESC;
    `, [q.rows[0].id]);

    expect(assigns.rows.length).toBe(2);
    expect(assigns.rows[0].guests_allocated).toBe(4);
    expect(assigns.rows[1].guests_allocated).toBe(2);
  });

  // L. Release updates occupancy correctly
  it('L. Release updates occupancy correctly on shared table', async () => {
    // Create a 6-seat table with two 2-person parties
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-L-SHARED', 6, 0, 'AVAILABLE')
      RETURNING id;
    `, [STRICT_REST_ID]);
    const tableId = t.rows[0].id;

    const q1 = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party L1', 2, 'WAITING', 301, 301)
      RETURNING id;
    `, [STRICT_REST_ID]);
    const q2 = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party L2', 2, 'WAITING', 302, 302)
      RETURNING id;
    `, [STRICT_REST_ID]);

    await client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [q1.rows[0].id, tableId, ACTOR_ID]);
    await client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [q2.rows[0].id, tableId, ACTOR_ID]);

    const midTable = await client.query(`SELECT occupied_seats, free_seats FROM public.restaurant_tables WHERE id = $1`, [tableId]);
    expect(midTable.rows[0].occupied_seats).toBe(4);
    expect(midTable.rows[0].free_seats).toBe(2);

    // Release party 1 using QueueService.exitSeatedCustomer
    await QueueService.exitSeatedCustomer(q1.rows[0].id, ACTOR_ID);

    const afterRelease = await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [tableId]);
    expect(afterRelease.rows[0].occupied_seats).toBe(2);
    expect(afterRelease.rows[0].free_seats).toBe(4);
    expect(afterRelease.rows[0].status).toBe('OCCUPIED');
  });

  // M. Final release results in 0/capacity and transition to CLEANING
  it('M. Final release results in 0/capacity and transition to CLEANING', async () => {
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-M-FINAL', 4, 'AVAILABLE')
      RETURNING id;
    `, [STRICT_REST_ID]);
    const tableId = t.rows[0].id;

    const q = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Solo Party M', 4, 'WAITING', 401, 401)
      RETURNING id;
    `, [STRICT_REST_ID]);

    await client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [q.rows[0].id, tableId, ACTOR_ID]);
    await QueueService.exitSeatedCustomer(q.rows[0].id, ACTOR_ID);

    const finalTable = await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [tableId]);
    expect(finalTable.rows[0].occupied_seats).toBe(0);
    expect(finalTable.rows[0].free_seats).toBe(4);
    expect(finalTable.rows[0].status).toBe('CLEANING');
  });

  // N. Concurrent final-seat allocation allows exactly one valid winner
  it('N. Concurrent final-seat allocation allows exactly one valid winner', async () => {
    // 4-seat table in STRICT mode with 2 occupied, 2 free
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-N-RACE', 4, 2, 'OCCUPIED')
      RETURNING id;
    `, [STRICT_REST_ID]);
    const tableId = t.rows[0].id;

    const q1 = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Competitor 1', 2, 'WAITING', 501, 501)
      RETURNING id;
    `, [STRICT_REST_ID]);
    const q2 = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Competitor 2', 2, 'WAITING', 502, 502)
      RETURNING id;
    `, [STRICT_REST_ID]);

    // Concurrently attempt to seat both 2-guest parties into the last 2 seats
    const results = await Promise.allSettled([
      client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [q1.rows[0].id, tableId, ACTOR_ID]),
      client.query(`SELECT public.seat_queue_entry_atomic($1, $2, $3)`, [q2.rows[0].id, tableId, ACTOR_ID]),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const finalTable = await client.query(`SELECT occupied_seats, free_seats FROM public.restaurant_tables WHERE id = $1`, [tableId]);
    expect(finalTable.rows[0].occupied_seats).toBe(4);
    expect(finalTable.rows[0].free_seats).toBe(0);
  });

  // O. Graphical UI receives correct occupancy data
  it('O. Graphical UI receives correct occupancy data', async () => {
    const t = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-O-UI', 6, 4, 'OCCUPIED')
      RETURNING id, capacity, occupied_seats, free_seats;
    `, [STRICT_REST_ID]);
    const row = t.rows[0];

    // UI format expectation: 4 / 6 and 2 free
    const textFormat = `${row.occupied_seats}/${row.capacity} • ${row.free_seats} free`;
    expect(textFormat).toBe('4/6 • 2 free');
  });

  // P. Recommendation engine sees correct free capacity
  it('P. Recommendation engine sees correct free capacity', async () => {
    // 6-seat table with 4 occupied, 2 free in STRICT mode
    await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, status)
      VALUES ($1, 'T-P-REC', 6, 4, 'OCCUPIED')
      RETURNING id;
    `, [STRICT_REST_ID]);

    const qParty2 = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party P2', 2, 'WAITING', 601, 601)
      RETURNING id;
    `, [STRICT_REST_ID]);

    const qParty3 = await client.query(`
      INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
      VALUES ($1, 'Party P3', 3, 'WAITING', 602, 602)
      RETURNING id;
    `, [STRICT_REST_ID]);

    const recsParty2 = await QueueService.recommendTablesForQueueEntry(qParty2.rows[0].id);
    const recsParty3 = await QueueService.recommendTablesForQueueEntry(qParty3.rows[0].id);

    // Party 2 should find table T-P-REC as a shared recommendation
    const found2 = recsParty2.find((r) => r.table_number === 'T-P-REC' && r.is_shared);
    expect(found2).toBeDefined();

    // Party 3 should NOT find table T-P-REC (free_seats 2 < partySize 3)
    const found3 = recsParty3.find((r) => r.table_number === 'T-P-REC');
    expect(found3).toBeUndefined();
  });

  // Q. No direct unrestricted occupancy modification remains
  it('Q. No direct unrestricted occupancy modification remains in TableService schemas', () => {
    const rawCreate = createTableSchema.safeParse({
      tableNumber: '100',
      capacity: 4,
      occupied_seats: 10, // Attempted direct override
      free_seats: 0,
    });
    expect(rawCreate.success).toBe(true);
    // TypeScript/Zod schema strips or ignores occupied_seats and free_seats
    expect((rawCreate.data as any).occupied_seats).toBeUndefined();
    expect((rawCreate.data as any).free_seats).toBeUndefined();

    const rawUpdate = updateTableSchema.safeParse({
      capacity: 6,
      occupied_seats: 99,
      free_seats: -5,
    });
    expect(rawUpdate.success).toBe(true);
    expect((rawUpdate.data as any).occupied_seats).toBeUndefined();
    expect((rawUpdate.data as any).free_seats).toBeUndefined();
  });
});

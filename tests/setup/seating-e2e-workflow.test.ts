import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import { QueueService } from '@/lib/services/queue-service';
import { TableService } from '@/lib/services/table-service';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('E2E Seating Workflow & Integrity Validation', () => {
  let client: Client;

  const RESTAURANT_SIMPLE_ID = 'e2e00000-0000-4000-8000-000000000001';
  const RESTAURANT_STRICT_ID = 'e2e00000-0000-4000-8000-000000000002';
  const RESTAURANT_OTHER_ID  = 'e2e00000-0000-4000-8000-000000000003';

  // Dedicated single-membership actors to prevent maybeSingle() collision in TableService
  const ACTOR_SIMPLE_ID = 'e2e00000-0000-4000-a000-000000000001';
  const ACTOR_STRICT_ID = 'e2e00000-0000-4000-a000-000000000002';
  const ACTOR_OTHER_ID  = 'e2e00000-0000-4000-a000-000000000003';

  let qNum = 100;
  const nextQ = () => {
    qNum++;
    return { num: qNum, disp: `Q-${qNum}` };
  };

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local');
    }
    client = new Client({ connectionString });
    await client.connect();

    // 1. Seed actor users & profiles
    for (const [actorId, email, name] of [
      [ACTOR_SIMPLE_ID, 'e2e-simple-actor@queueflow.io', 'E2E Simple Actor'],
      [ACTOR_STRICT_ID, 'e2e-strict-actor@queueflow.io', 'E2E Strict Actor'],
      [ACTOR_OTHER_ID,  'e2e-other-actor@queueflow.io',  'E2E Other Actor'],
    ]) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, email, aud, role)
        VALUES ('${actorId}', '00000000-0000-0000-0000-000000000000', '${email}', 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO public.user_profiles (id, display_name, email)
        VALUES ('${actorId}', '${name}', '${email}')
        ON CONFLICT (id) DO NOTHING;
      `);
    }

    // 2. Seed restaurants
    await client.query(`
      INSERT INTO public.restaurants (id, name, slug, seating_mode, status, queue_enabled)
      VALUES 
        ('${RESTAURANT_SIMPLE_ID}', 'E2E Simple Restaurant', 'e2e-simple-dining', 'SIMPLE', 'ACTIVE', true),
        ('${RESTAURANT_STRICT_ID}', 'E2E Strict Restaurant', 'e2e-strict-dining', 'STRICT', 'ACTIVE', true),
        ('${RESTAURANT_OTHER_ID}',  'E2E Other Restaurant',  'e2e-other-tenant',  'SIMPLE', 'ACTIVE', true)
      ON CONFLICT (id) DO UPDATE SET
        seating_mode = EXCLUDED.seating_mode,
        status = 'ACTIVE',
        queue_enabled = true;
    `);

    // 3. Memberships (one per actor)
    await client.query(`
      INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
      VALUES 
        ('${ACTOR_SIMPLE_ID}', '${RESTAURANT_SIMPLE_ID}', 'RESTAURANT_ADMIN', 'ACTIVE'),
        ('${ACTOR_STRICT_ID}', '${RESTAURANT_STRICT_ID}', 'RESTAURANT_ADMIN', 'ACTIVE'),
        ('${ACTOR_OTHER_ID}',  '${RESTAURANT_OTHER_ID}',  'RESTAURANT_ADMIN', 'ACTIVE')
      ON CONFLICT DO NOTHING;
    `);

    // Clean any prior run residue
    for (const rid of [RESTAURANT_SIMPLE_ID, RESTAURANT_STRICT_ID, RESTAURANT_OTHER_ID]) {
      await client.query(`DELETE FROM public.active_seating_assignments WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.queue_events WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.restaurant_tables WHERE restaurant_id = $1`, [rid]);
    }
  });

  afterAll(async () => {
    // Teardown disposable fixtures
    for (const rid of [RESTAURANT_SIMPLE_ID, RESTAURANT_STRICT_ID, RESTAURANT_OTHER_ID]) {
      await client.query(`DELETE FROM public.active_seating_assignments WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.queue_events WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.restaurant_tables WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.restaurant_memberships WHERE restaurant_id = $1`, [rid]);
      await client.query(`DELETE FROM public.restaurants WHERE id = $1`, [rid]);
    }
    for (const actorId of [ACTOR_SIMPLE_ID, ACTOR_STRICT_ID, ACTOR_OTHER_ID]) {
      await client.query(`DELETE FROM public.user_profiles WHERE id = $1`, [actorId]);
      await client.query(`DELETE FROM auth.users WHERE id = $1`, [actorId]);
    }
    await client.end();
  });

  // =========================================================================
  // 1. SIMPLE MODE — COMPLETE WORKFLOW
  // =========================================================================
  describe('1. Simple Mode — Complete Staff Workflow', () => {
    let t1Id: string;
    let t2Id: string;
    let t3Id: string;
    let partyAId: string;
    let partyBId: string;
    let partyCId: string;

    beforeAll(async () => {
      // Tables: T1 cap 2, T2 cap 4, T3 cap 6
      const t1 = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T1', 2, 'AVAILABLE') RETURNING id;
      `);
      const t2 = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T2', 4, 'AVAILABLE') RETURNING id;
      `);
      const t3 = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T3', 6, 'AVAILABLE') RETURNING id;
      `);
      t1Id = t1.rows[0].id;
      t2Id = t2.rows[0].id;
      t3Id = t3.rows[0].id;

      // Queue: Party A=4, Party B=2, Party C=6
      const qAData = nextQ();
      const qa = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Party A', 4, 'WAITING', ${qAData.num}, '${qAData.disp}') RETURNING id;
      `);
      const qBData = nextQ();
      const qb = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Party B', 2, 'WAITING', ${qBData.num}, '${qBData.disp}') RETURNING id;
      `);
      const qCData = nextQ();
      const qc = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Party C', 6, 'WAITING', ${qCData.num}, '${qCData.disp}') RETURNING id;
      `);
      partyAId = qa.rows[0].id;
      partyBId = qb.rows[0].id;
      partyCId = qc.rows[0].id;
    });

    it('1.A Party A: Recommends exact-fit T2, excludes insufficient T1, prefers T2 over T3', async () => {
      const recs = await QueueService.recommendTablesForQueueEntry(partyAId, ACTOR_SIMPLE_ID);
      expect(recs.length).toBeGreaterThan(0);

      // Top recommendation must be T2 (capacity 4 exact fit)
      expect(recs[0]!.table_id).toBe(t2Id);
      expect(recs[0]!.capacity).toBe(4);
      expect(recs[0]!.rank).toBe(1);

      // T1 (capacity 2) cannot fit 4 guests alone
      const t1Single = recs.find(r => r.table_id === t1Id && !r.is_combination);
      expect(t1Single).toBeUndefined();

      // T3 (capacity 6) fits with waste, ranked lower than T2
      const t2Rec = recs.find(r => r.table_id === t2Id);
      const t3Rec = recs.find(r => r.table_id === t3Id);
      expect(t2Rec).toBeDefined();
      expect(t3Rec).toBeDefined();
      expect(t2Rec!.rank).toBeLessThan(t3Rec!.rank);
    });

    it('1.B Staff confirms T2 for Party A: Atomic SEATED, assignment created, occupancy 4/0, queue events/compat', async () => {
      await QueueService.seatQueueEntry(partyAId, t2Id, ACTOR_SIMPLE_ID, 4);

      // Verify queue entry state
      const qRow = (await client.query(`SELECT status, seated_table_id FROM public.queue_entries WHERE id = $1`, [partyAId])).rows[0];
      expect(qRow.status).toBe('SEATED');
      expect(qRow.seated_table_id).toBe(t2Id);

      // Verify table occupancy
      const tRow = (await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [t2Id])).rows[0];
      expect(tRow.status).toBe('OCCUPIED');
      expect(tRow.occupied_seats).toBe(4);
      expect(tRow.free_seats).toBe(0);

      // Verify active_seating_assignments
      const assign = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE queue_entry_id = $1`, [partyAId])).rows;
      expect(assign).toHaveLength(1);
      expect(assign[0].table_id).toBe(t2Id);
      expect(assign[0].guests_allocated).toBe(4);
      expect(assign[0].is_primary).toBe(true);

      // Verify audit/queue events
      const events = (await client.query(`SELECT event_type FROM public.queue_events WHERE queue_entry_id = $1`, [partyAId])).rows;
      expect(events.some(e => e.event_type === 'QUEUE_SEATED')).toBe(true);
    });

    it('1.C Party B: T2 is NOT recommended (SIMPLE forbids sharing), T1 is eligible & preferred', async () => {
      const recs = await QueueService.recommendTablesForQueueEntry(partyBId, ACTOR_SIMPLE_ID);
      
      // T2 is occupied, so in SIMPLE mode it must NOT be recommended
      const t2InRecs = recs.find(r => r.table_id === t2Id || (r.table_ids && r.table_ids.includes(t2Id)));
      expect(t2InRecs).toBeUndefined();

      // T1 is available and exact fit for party of 2
      expect(recs[0]!.table_id).toBe(t1Id);
      expect(recs[0]!.capacity).toBe(2);
      expect(recs[0]!.rank).toBe(1);
    });

    it('1.D Party C: Multi-table combination logic when single 6-seat table is unavailable', async () => {
      // Mark T3 OCCUPIED so no single 6-seat table is available
      await client.query(`UPDATE public.restaurant_tables SET status = 'OCCUPIED', occupied_seats = 6, free_seats = 0 WHERE id = $1`, [t3Id]);
      
      // Add another table T4 (cap 4) so T1 (cap 2) + T4 (cap 4) can combine to fit 6
      const t4 = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T4', 4, 'AVAILABLE') RETURNING id;
      `);
      const t4Id = t4.rows[0].id;

      // Check recommendation
      const recs = await QueueService.recommendTablesForQueueEntry(partyCId, ACTOR_SIMPLE_ID);
      const combo = recs.find(r => r.is_combination && r.capacity >= 6);
      expect(combo).toBeDefined();
      expect(combo!.table_ids).toContain(t1Id);
      expect(combo!.table_ids).toContain(t4Id);

      // Staff seats Party C across T1 + T4 atomically
      await QueueService.seatQueueEntry(partyCId, t1Id, ACTOR_SIMPLE_ID, 6, [t4Id]);

      // Verify single queue entry is SEATED
      const qRow = (await client.query(`SELECT status, seated_table_id FROM public.queue_entries WHERE id = $1`, [partyCId])).rows[0];
      expect(qRow.status).toBe('SEATED');
      expect(qRow.seated_table_id).toBe(t1Id);

      // Verify multiple tables assigned atomically
      const assigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE queue_entry_id = $1`, [partyCId])).rows;
      expect(assigns).toHaveLength(2);
      const totalGuests = assigns.reduce((sum, a) => sum + a.guests_allocated, 0);
      expect(totalGuests).toBe(6);

      // Verify both tables updated
      const t1Row = (await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [t1Id])).rows[0];
      const t4Row = (await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [t4Id])).rows[0];
      expect(t1Row.status).toBe('OCCUPIED');
      expect(t1Row.occupied_seats).toBe(2);
      expect(t4Row.status).toBe('OCCUPIED');
      expect(t4Row.occupied_seats).toBe(4);
    });
  });

  // =========================================================================
  // 2. STRICT MODE — SHARED TABLE WORKFLOW
  // =========================================================================
  describe('2. Strict Mode — Shared Table Workflow', () => {
    let t1Id: string;
    let partyInitId: string;
    let partyAId: string;
    let partyBId: string;
    let partyCId: string;

    beforeAll(async () => {
      // T1: capacity = 6, occupied = 4, free = 2, status = OCCUPIED
      const t1 = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, free_seats, status)
        VALUES ('${RESTAURANT_STRICT_ID}', 'T1-STRICT', 6, 4, 2, 'OCCUPIED') RETURNING id;
      `);
      t1Id = t1.rows[0].id;

      // Party Initial currently seated (occupying 4 seats)
      const qInitData = nextQ();
      const qInit = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, seated_table_id, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Party Initial', 4, 'SEATED', '${t1Id}', ${qInitData.num}, '${qInitData.disp}') RETURNING id;
      `);
      partyInitId = qInit.rows[0].id;
      await client.query(`
        INSERT INTO public.active_seating_assignments (restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary)
        VALUES ('${RESTAURANT_STRICT_ID}', '${partyInitId}', '${t1Id}', 4, true);
      `);

      // Queue: Party A = 4, Party B = 2, Party C = 1
      const qAData = nextQ();
      const qa = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Party A Strict', 4, 'WAITING', ${qAData.num}, '${qAData.disp}') RETURNING id;
      `);
      const qBData = nextQ();
      const qb = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Party B Strict', 2, 'WAITING', ${qBData.num}, '${qBData.disp}') RETURNING id;
      `);
      const qCData = nextQ();
      const qc = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Party C Strict', 1, 'WAITING', ${qCData.num}, '${qCData.disp}') RETURNING id;
      `);
      partyAId = qa.rows[0].id;
      partyBId = qb.rows[0].id;
      partyCId = qc.rows[0].id;
    });

    it('2.A Party A (size 4): T1 is NOT recommended because only 2 seats are free', async () => {
      const recs = await QueueService.recommendTablesForQueueEntry(partyAId, ACTOR_STRICT_ID);
      const t1InRecs = recs.find(r => r.table_id === t1Id);
      expect(t1InRecs).toBeUndefined();
    });

    it('2.B Party B (size 2): T1 is eligible for the 2 available seats as a shared table', async () => {
      const recs = await QueueService.recommendTablesForQueueEntry(partyBId, ACTOR_STRICT_ID);
      const t1InRecs = recs.find(r => r.table_id === t1Id);
      expect(t1InRecs).toBeDefined();
      expect(t1InRecs!.is_shared).toBe(true);
      expect(t1InRecs!.reason).toContain('2 free seats');
    });

    it('2.C Party C (size 1): T1 is physically compatible and ranked by waste', async () => {
      const recs = await QueueService.recommendTablesForQueueEntry(partyCId, ACTOR_STRICT_ID);
      const t1InRecs = recs.find(r => r.table_id === t1Id);
      expect(t1InRecs).toBeDefined();
      expect(t1InRecs!.is_shared).toBe(true);
    });

    it('2.D Staff seats Party B on T1: T1 becomes 6/6, free=0, both assignments present, Party A waits', async () => {
      await QueueService.seatQueueEntry(partyBId, t1Id, ACTOR_STRICT_ID, 2);

      // T1 occupancy updated
      const t1Row = (await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [t1Id])).rows[0];
      expect(t1Row.occupied_seats).toBe(6);
      expect(t1Row.free_seats).toBe(0);
      expect(t1Row.status).toBe('OCCUPIED');

      // Both active assignments present
      const assigns = (await client.query(`SELECT queue_entry_id, guests_allocated FROM public.active_seating_assignments WHERE table_id = $1`, [t1Id])).rows;
      expect(assigns).toHaveLength(2);
      expect(assigns.find(a => a.queue_entry_id === partyInitId)!.guests_allocated).toBe(4);
      expect(assigns.find(a => a.queue_entry_id === partyBId)!.guests_allocated).toBe(2);

      // Party statuses
      const qARow = (await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [partyAId])).rows[0];
      const qBRow = (await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [partyBId])).rows[0];
      expect(qARow.status).toBe('WAITING');
      expect(qBRow.status).toBe('SEATED');
    });

    // =======================================================================
    // 3. SHARED TABLE EXIT
    // =======================================================================
    it('3.A Party B leaves: Party B assignment removed, Party Initial remains, T1 becomes 4/6 (OCCUPIED)', async () => {
      await QueueService.exitSeatedCustomer(partyBId, ACTOR_STRICT_ID);

      // Assignments check
      const assigns = (await client.query(`SELECT queue_entry_id, guests_allocated FROM public.active_seating_assignments WHERE table_id = $1`, [t1Id])).rows;
      expect(assigns).toHaveLength(1);
      expect(assigns[0].queue_entry_id).toBe(partyInitId);
      expect(assigns[0].guests_allocated).toBe(4);

      // Table state check
      const t1Row = (await client.query(`SELECT occupied_seats, free_seats, status FROM public.restaurant_tables WHERE id = $1`, [t1Id])).rows[0];
      expect(t1Row.occupied_seats).toBe(4);
      expect(t1Row.free_seats).toBe(2);
      expect(t1Row.status).toBe('OCCUPIED');

      // Party Initial remains SEATED
      const qInitRow = (await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [partyInitId])).rows[0];
      expect(qInitRow.status).toBe('SEATED');
    });

    it('3.B Party Initial leaves: No assignments remain, T1 transitions to CLEANING, 0/6', async () => {
      await QueueService.exitSeatedCustomer(partyInitId, ACTOR_STRICT_ID);

      const assigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE table_id = $1`, [t1Id])).rows;
      expect(assigns).toHaveLength(0);

      const t1Row = (await client.query(`SELECT occupied_seats, free_seats, status, capacity FROM public.restaurant_tables WHERE id = $1`, [t1Id])).rows[0];
      expect(t1Row.status).toBe('CLEANING');
      expect(t1Row.occupied_seats).toBe(0);
      expect(t1Row.free_seats).toBe(6);
    });

    it('3.C Staff marks T1 AVAILABLE: eligible for new seating, occupancy remains 0/capacity', async () => {
      await TableService.updateTableStatus(t1Id, 'AVAILABLE', 'CLEANING', RESTAURANT_STRICT_ID, ACTOR_STRICT_ID);

      const t1Row = (await client.query(`SELECT occupied_seats, free_seats, status, capacity FROM public.restaurant_tables WHERE id = $1`, [t1Id])).rows[0];
      expect(t1Row.status).toBe('AVAILABLE');
      expect(t1Row.occupied_seats).toBe(0);
      expect(t1Row.free_seats).toBe(6);
    });
  });

  // =========================================================================
  // 4. UI WORKFLOW DATA CONTRACT VALIDATION
  // =========================================================================
  describe('4. UI Workflow Contracts & Data Mapping', () => {
    it('Verifies recommendation output schema conforms with SeatCustomerModal requirements', async () => {
      await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-UI-1', 4, 'AVAILABLE') RETURNING id;
      `);
      const qData = nextQ();
      const qRow = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'UI Customer', 4, 'WAITING', ${qData.num}, '${qData.disp}') RETURNING id;
      `);

      const recs = await QueueService.recommendTablesForQueueEntry(qRow.rows[0].id, ACTOR_SIMPLE_ID);
      expect(recs.length).toBeGreaterThan(0);
      const first = recs[0];

      // Fields required by SeatCustomerModal
      expect(first).toHaveProperty('table_id');
      expect(first).toHaveProperty('table_number');
      expect(first).toHaveProperty('capacity');
      expect(first).toHaveProperty('rank');
      expect(first).toHaveProperty('reason');
      expect(first).toHaveProperty('is_combination');
      expect(first).toHaveProperty('is_shared');
      expect(first).toHaveProperty('table_ids');
    });

    it('Verifies TableService.listTables supplies occupiedSeats, freeSeats, and status for floor view', async () => {
      const list = await TableService.listTables({ restaurantId: RESTAURANT_SIMPLE_ID, userId: ACTOR_SIMPLE_ID });
      expect(list.tables.length).toBeGreaterThan(0);
      const t = list.tables[0];
      expect(t).toHaveProperty('occupiedSeats');
      expect(t).toHaveProperty('freeSeats');
      expect(t).toHaveProperty('status');
      expect(t).toHaveProperty('shape');
    });
  });

  // =========================================================================
  // 5. ERROR & RECOVERY TESTS
  // =========================================================================
  describe('5. Error & Recovery Tests (8 Specific Cases)', () => {
    let testTableId: string;
    let testQueueId: string;

    beforeAll(async () => {
      const t = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-ERR', 4, 'AVAILABLE') RETURNING id;
      `);
      testTableId = t.rows[0].id;
      const qData = nextQ();
      const q = await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Err Customer', 2, 'WAITING', ${qData.num}, '${qData.disp}') RETURNING id;
      `);
      testQueueId = q.rows[0].id;
    });

    it('5.1 Staff tries to seat an already SEATED customer -> Clean rejection', async () => {
      await QueueService.seatQueueEntry(testQueueId, testTableId, ACTOR_SIMPLE_ID, 2);
      await expect(
        QueueService.seatQueueEntry(testQueueId, testTableId, ACTOR_SIMPLE_ID, 2)
      ).rejects.toThrow(/ALREADY_SEATED|TERMINAL/);
    });

    it('5.2 Staff tries to use an occupied table in SIMPLE mode -> Clean rejection', async () => {
      const q2Data = nextQ();
      const q2 = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Err Customer 2', 2, 'WAITING', ${q2Data.num}, '${q2Data.disp}') RETURNING id;
      `)).rows[0].id;

      await expect(
        QueueService.seatQueueEntry(q2, testTableId, ACTOR_SIMPLE_ID, 2)
      ).rejects.toThrow('TABLE_NOT_AVAILABLE');
    });

    it('5.3 Staff tries to seat more guests than available STRICT capacity -> Clean rejection', async () => {
      const tStrict = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, free_seats, status)
        VALUES ('${RESTAURANT_STRICT_ID}', 'T-STRICT-CAP', 4, 3, 1, 'OCCUPIED') RETURNING id;
      `)).rows[0].id;
      const qStrictData = nextQ();
      const qStrict = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Strict Big Party', 2, 'WAITING', ${qStrictData.num}, '${qStrictData.disp}') RETURNING id;
      `)).rows[0].id;

      // Trying to seat 2 guests when only 1 free seat exists
      await expect(
        QueueService.seatQueueEntry(qStrict, tStrict, ACTOR_STRICT_ID, 2)
      ).rejects.toThrow('INSUFFICIENT_TABLE_CAPACITY');
    });

    it('5.4 Multi-table combination where one table is unavailable -> Atomic failure, NO partial seating', async () => {
      const tc1 = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'TC-OK', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;
      const tc2 = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'TC-OCCUPIED', 2, 'OCCUPIED') RETURNING id;
      `)).rows[0].id;
      const qCombData = nextQ();
      const qComb = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Combo Party Err', 4, 'WAITING', ${qCombData.num}, '${qCombData.disp}') RETURNING id;
      `)).rows[0].id;

      await expect(
        QueueService.seatQueueEntry(qComb, tc1, ACTOR_SIMPLE_ID, 4, [tc2])
      ).rejects.toThrow('TABLE_NOT_AVAILABLE');

      // Verify NO partial assignment for tc1
      const assigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE table_id = $1`, [tc1])).rows;
      expect(assigns).toHaveLength(0);
      const qState = (await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [qComb])).rows[0].status;
      expect(qState).toBe('WAITING');
    });

    it('5.5 Staff attempts cross-restaurant table/queue combination -> Rejected by tenant validation', async () => {
      const qOtherData = nextQ();
      const qOther = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_OTHER_ID}', 'Other Tenant Party', 2, 'WAITING', ${qOtherData.num}, '${qOtherData.disp}') RETURNING id;
      `)).rows[0].id;

      await expect(
        QueueService.seatQueueEntry(qOther, testTableId, ACTOR_OTHER_ID, 2)
      ).rejects.toThrow(/TENANT_MISMATCH|UNAUTHORIZED/);
    });

    it('5.6 Table is CLEANING -> Cannot be seated into', async () => {
      const tClean = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-CLEAN-ERR', 2, 'CLEANING') RETURNING id;
      `)).rows[0].id;
      const qCleanData = nextQ();
      const qClean = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Clean Target Party', 2, 'WAITING', ${qCleanData.num}, '${qCleanData.disp}') RETURNING id;
      `)).rows[0].id;

      await expect(
        QueueService.seatQueueEntry(qClean, tClean, ACTOR_SIMPLE_ID, 2)
      ).rejects.toThrow('TABLE_NOT_AVAILABLE');
    });

    it('5.7 Table is OUT_OF_SERVICE -> Cannot be seated into', async () => {
      const tOos = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-OOS-ERR', 2, 'OUT_OF_SERVICE') RETURNING id;
      `)).rows[0].id;
      const qOosData = nextQ();
      const qOos = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'OOS Target Party', 2, 'WAITING', ${qOosData.num}, '${qOosData.disp}') RETURNING id;
      `)).rows[0].id;

      await expect(
        QueueService.seatQueueEntry(qOos, tOos, ACTOR_SIMPLE_ID, 2)
      ).rejects.toThrow('TABLE_NOT_AVAILABLE');
    });

    it('5.8 Table becomes unavailable between recommendation and confirmation -> Controlled error, DB protected', async () => {
      const tStale = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-STALE-ERR', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;
      const qStaleData = nextQ();
      const qStale = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Stale Party', 2, 'WAITING', ${qStaleData.num}, '${qStaleData.disp}') RETURNING id;
      `)).rows[0].id;

      // 1. Recommendation engine returns table as available
      const recs = await QueueService.recommendTablesForQueueEntry(qStale, ACTOR_SIMPLE_ID);
      expect(recs.some(r => r.table_id === tStale)).toBe(true);

      // 2. Concurrently, table becomes occupied
      await client.query(`UPDATE public.restaurant_tables SET status = 'OCCUPIED', occupied_seats = 2, free_seats = 0 WHERE id = $1`, [tStale]);

      // 3. User attempts to seat based on stale recommendation
      await expect(
        QueueService.seatQueueEntry(qStale, tStale, ACTOR_SIMPLE_ID, 2)
      ).rejects.toThrow('TABLE_NOT_AVAILABLE');

      const qStatus = (await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [qStale])).rows[0].status;
      expect(qStatus).toBe('WAITING');
    });
  });

  // =========================================================================
  // 6. CONCURRENCY WORKFLOW
  // =========================================================================
  describe('6. Concurrency Workflow (Races A, B, C)', () => {
    it('RACE A: Two staff users attempt to seat two parties onto same remaining STRICT seats', async () => {
      const tRaceA = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, occupied_seats, free_seats, status)
        VALUES ('${RESTAURANT_STRICT_ID}', 'T-RACE-A', 4, 2, 2, 'OCCUPIED') RETURNING id;
      `)).rows[0].id;
      // Existing assignment for 2 seats
      await client.query(`
        INSERT INTO public.queue_entries (id, restaurant_id, customer_name, party_size, status, seated_table_id, queue_number, display_number)
        VALUES ('e2e00000-0000-4000-c000-000000000001', '${RESTAURANT_STRICT_ID}', 'Race Prior', 2, 'SEATED', '${tRaceA}', 991, 'Q-991');
        INSERT INTO public.active_seating_assignments (restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary)
        VALUES ('${RESTAURANT_STRICT_ID}', 'e2e00000-0000-4000-c000-000000000001', '${tRaceA}', 2, true);
      `);

      const qA1Data = nextQ();
      const pA1 = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Race A Party 1', 2, 'WAITING', ${qA1Data.num}, '${qA1Data.disp}') RETURNING id;
      `)).rows[0].id;
      const qA2Data = nextQ();
      const pA2 = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_STRICT_ID}', 'Race A Party 2', 2, 'WAITING', ${qA2Data.num}, '${qA2Data.disp}') RETURNING id;
      `)).rows[0].id;

      const [res1, res2] = await Promise.allSettled([
        QueueService.seatQueueEntry(pA1, tRaceA, ACTOR_STRICT_ID, 2),
        QueueService.seatQueueEntry(pA2, tRaceA, ACTOR_STRICT_ID, 2),
      ]);

      const successes = [res1, res2].filter(r => r.status === 'fulfilled');
      const failures = [res1, res2].filter(r => r.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // Check table state: perfectly filled 4/0
      const tState = (await client.query(`SELECT occupied_seats, free_seats FROM public.restaurant_tables WHERE id = $1`, [tRaceA])).rows[0];
      expect(tState.occupied_seats).toBe(4);
      expect(tState.free_seats).toBe(0);

      const assigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE table_id = $1`, [tRaceA])).rows;
      expect(assigns).toHaveLength(2);
    });

    it('RACE B: Two staff users attempt to seat the same queue entry simultaneously', async () => {
      const t1 = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-RACE-B1', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;
      const t2 = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'T-RACE-B2', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;
      const qData = nextQ();
      const q = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Race B Party', 2, 'WAITING', ${qData.num}, '${qData.disp}') RETURNING id;
      `)).rows[0].id;

      const [res1, res2] = await Promise.allSettled([
        QueueService.seatQueueEntry(q, t1, ACTOR_SIMPLE_ID, 2),
        QueueService.seatQueueEntry(q, t2, ACTOR_SIMPLE_ID, 2),
      ]);

      const successes = [res1, res2].filter(r => r.status === 'fulfilled');
      const failures = [res1, res2].filter(r => r.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const assigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE queue_entry_id = $1`, [q])).rows;
      expect(assigns).toHaveLength(1);
    });

    it('RACE C: Two staff users attempt different multi-table combinations sharing one table', async () => {
      const ts = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'TS-COMBO', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;
      const tx = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'TX-COMBO', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;
      const ty = (await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'TY-COMBO', 2, 'AVAILABLE') RETURNING id;
      `)).rows[0].id;

      const q1Data = nextQ();
      const q1 = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Combo Contestant 1', 4, 'WAITING', ${q1Data.num}, '${q1Data.disp}') RETURNING id;
      `)).rows[0].id;
      const q2Data = nextQ();
      const q2 = (await client.query(`
        INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, status, queue_number, display_number)
        VALUES ('${RESTAURANT_SIMPLE_ID}', 'Combo Contestant 2', 4, 'WAITING', ${q2Data.num}, '${q2Data.disp}') RETURNING id;
      `)).rows[0].id;

      const [res1, res2] = await Promise.allSettled([
        QueueService.seatQueueEntry(q1, ts, ACTOR_SIMPLE_ID, 4, [tx]),
        QueueService.seatQueueEntry(q2, ts, ACTOR_SIMPLE_ID, 4, [ty]),
      ]);

      const successes = [res1, res2].filter(r => r.status === 'fulfilled');
      const failures = [res1, res2].filter(r => r.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const tsAssigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE table_id = $1`, [ts])).rows;
      const txAssigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE table_id = $1`, [tx])).rows;
      const tyAssigns = (await client.query(`SELECT * FROM public.active_seating_assignments WHERE table_id = $1`, [ty])).rows;

      const winnerQueueId = tsAssigns[0]?.queue_entry_id;
      const loserUnrelatedAssigns = winnerQueueId === q1 ? tyAssigns : txAssigns;
      // No partial assignment for the losing combo
      expect(loserUnrelatedAssigns).toHaveLength(0);
    });
  });

  // =========================================================================
  // 7. DATA INTEGRITY AUDIT AFTER ALL TESTS
  // =========================================================================
  describe('7. Data Integrity Audit (Checks A through J)', () => {
    it('Check A: occupied_seats >= 0 across all tables', async () => {
      const res = await client.query(`SELECT count(*) FROM public.restaurant_tables WHERE occupied_seats < 0`);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check B: occupied_seats <= capacity across all tables', async () => {
      const res = await client.query(`SELECT count(*) FROM public.restaurant_tables WHERE occupied_seats > capacity`);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check C: free_seats >= 0 across all tables', async () => {
      const res = await client.query(`SELECT count(*) FROM public.restaurant_tables WHERE free_seats < 0`);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check D: free_seats <= capacity across all tables', async () => {
      const res = await client.query(`SELECT count(*) FROM public.restaurant_tables WHERE free_seats > capacity`);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check E: free_seats = capacity - occupied_seats across all tables', async () => {
      const res = await client.query(`SELECT count(*) FROM public.restaurant_tables WHERE free_seats != (capacity - occupied_seats)`);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check F: Every active seating assignment references an existing queue entry', async () => {
      const res = await client.query(`
        SELECT count(*) FROM public.active_seating_assignments a
        WHERE NOT EXISTS (SELECT 1 FROM public.queue_entries q WHERE q.id = a.queue_entry_id)
      `);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check G: Every active assignment belongs to same restaurant as queue entry & table', async () => {
      const res = await client.query(`
        SELECT count(*) FROM public.active_seating_assignments a
        JOIN public.queue_entries q ON a.queue_entry_id = q.id
        JOIN public.restaurant_tables t ON a.table_id = t.id
        WHERE a.restaurant_id != q.restaurant_id OR a.restaurant_id != t.restaurant_id
      `);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check H: Current dining queue entries are accounted for', async () => {
      // For all records in the active test restaurants
      const res = await client.query(`
        SELECT count(*) FROM public.queue_entries
        WHERE restaurant_id IN ('${RESTAURANT_SIMPLE_ID}', '${RESTAURANT_STRICT_ID}', '${RESTAURANT_OTHER_ID}')
          AND status = 'SEATED' AND completed_at IS NULL
          AND id NOT IN (SELECT queue_entry_id FROM public.active_seating_assignments)
      `);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check I: Every active seating assignment belongs to a SEATED queue entry', async () => {
      const res = await client.query(`
        SELECT count(*) FROM public.active_seating_assignments a
        JOIN public.queue_entries q ON a.queue_entry_id = q.id
        WHERE q.status != 'SEATED'
      `);
      expect(Number(res.rows[0].count)).toBe(0);
    });

    it('Check J: For every table with active assignments: SUM(guests_allocated) = occupied_seats', async () => {
      const res = await client.query(`
        SELECT t.id, t.table_number, t.occupied_seats, COALESCE(SUM(a.guests_allocated), 0) as assigned
        FROM public.restaurant_tables t
        JOIN public.active_seating_assignments a ON t.id = a.table_id
        GROUP BY t.id, t.table_number, t.occupied_seats
        HAVING t.occupied_seats != COALESCE(SUM(a.guests_allocated), 0)
      `);
      expect(res.rows).toHaveLength(0);
    });
  });
});

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { ETAService } from '@/lib/services/eta-service';
import { QueueService } from '@/lib/services/queue-service';

// vi.mock is hoisted by Vitest — this correctly intercepts the app-layer
// requirePermission check in queue-service.ts before any test runs.
// The DB-level has_permission() check is satisfied by seeding test user
// permissions in the beforeAll setup block below.
vi.mock('@/lib/services/authorization-service', () => ({
  AuthorizationService: {
    requirePermission: vi.fn().mockImplementation(async (options: any) => ({
      userId: options.userId || '00000000-0000-0000-0000-000000000000',
      role: 'RESTAURANT_ADMIN',
      restaurantId: options.restaurantId || 'test-restaurant',
      membershipId: 'test-membership',
    })),
  },
}));

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 10: Queue Operations, Deterministic ETA Engine & Atomic Seating Tests', () => {
  let client: Client;

  // Dedicated test restaurant IDs for Phase 10 test suite to avoid cross-suite pollution
  const RESTAURANT_ID = '99999999-9999-4999-a999-999999999999';
  const RESTAURANT_SLUG = 'phase10-eta-seating-demo';

  const OTHER_RESTAURANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const OTHER_RESTAURANT_SLUG = 'phase10-other-demo';

  let tableSmallId: string;
  let tableMediumId: string;
  let tableLargeId: string;
  let TEST_ACTOR_ID: string;

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live Phase 10 tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    // Ensure dedicated test restaurants exist
    await client.query(`
      INSERT INTO public.restaurants (
        id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status,
        avg_service_time_mins, service_capacity_units, eta_buffer_mins, almost_your_turn_threshold
      )
      VALUES 
        ($1, 'Phase 10 Operations Demo', $2, true, 100, 1, 20, 'ACTIVE', 15, 2, 5, 10),
        ($3, 'Phase 10 Other Demo', $4, true, 100, 1, 20, 'ACTIVE', 15, 1, 5, 10)
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        avg_service_time_mins = 15,
        service_capacity_units = 2,
        eta_buffer_mins = 5,
        almost_your_turn_threshold = 10,
        status = 'ACTIVE';
    `, [RESTAURANT_ID, RESTAURANT_SLUG, OTHER_RESTAURANT_ID, OTHER_RESTAURANT_SLUG]);

    // Seed test actor user and grant queue.seat permission for RESTAURANT_ID.
    // Dedicated fixture actor (never a shared seed user): earlier versions used
    // `SELECT id FROM auth.users LIMIT 1`, which could pick a shared user
    // (e.g. alice) and grant them a second ACTIVE membership — breaking every
    // parallel suite that resolves memberships with maybeSingle().
    // The actor never signs in (server-side actor id only), so a minimal
    // auth.users row without identities is sufficient for FK constraints.
    TEST_ACTOR_ID = 'b0000000-0000-4000-b000-000000000010';
    await client.query(`
      INSERT INTO auth.users (id, instance_id, email, aud, role)
      VALUES ('${TEST_ACTOR_ID}', '00000000-0000-0000-0000-000000000000', 'phase10-actor@queueflow.io', 'authenticated', 'authenticated')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, display_name, email)
      VALUES ('${TEST_ACTOR_ID}', 'Phase 10 Test Actor', 'phase10-actor@queueflow.io')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Ensure restaurant membership with RESTAURANT_ADMIN role exists for test actor
    await client.query(`
      INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
      VALUES ($1, $2, 'RESTAURANT_ADMIN', 'ACTIVE')
      ON CONFLICT DO NOTHING;
    `, [TEST_ACTOR_ID, RESTAURANT_ID]);

    // Clean existing queue entries & tables for test restaurants
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_ID, OTHER_RESTAURANT_ID]);
    await client.query(`DELETE FROM public.restaurant_tables WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_ID, OTHER_RESTAURANT_ID]);

    // Insert test tables for RESTAURANT_ID
    const tableSmallRes = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-01', 2, 'AVAILABLE')
      RETURNING id;
    `, [RESTAURANT_ID]);
    tableSmallId = tableSmallRes.rows[0].id;

    const tableMediumRes = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-02', 4, 'AVAILABLE')
      RETURNING id;
    `, [RESTAURANT_ID]);
    tableMediumId = tableMediumRes.rows[0].id;

    const tableLargeRes = await client.query(`
      INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
      VALUES ($1, 'T-03', 8, 'AVAILABLE')
      RETURNING id;
    `, [RESTAURANT_ID]);
    tableLargeId = tableLargeRes.rows[0].id;
  });

  beforeEach(async () => {
    // Reset all tables to AVAILABLE before each test
    await client.query("UPDATE public.restaurant_tables SET status = 'AVAILABLE', occupied_seats = 0 WHERE restaurant_id = $1;", [RESTAURANT_ID]);
  });

  afterAll(async () => {
    // Remove fixed-id fixture restaurants so the shared database stays clean
    // between runs (recreated by beforeAll; DELETE cascades to child rows,
    // including the dedicated test actor's membership).
    if (client) {
      await client.query(`DELETE FROM public.restaurants WHERE id IN ($1, $2)`, [RESTAURANT_ID, OTHER_RESTAURANT_ID]).catch(() => undefined);
      await client.end();
    }
  });

  // ===========================================================================
  // 1. DETERMINISTIC ETA ENGINE CALCULATIONS
  // ===========================================================================
  describe('1. Deterministic ETA Engine', () => {
    it('calculates expected wait time based on formula: ceil((peopleAhead * avgTime) / capacity) + buffer', () => {
      // Setup: position = 5 (4 people ahead), avgTime = 15, capacity = 2, buffer = 5
      // Expected = ceil((4 * 15) / 2) + 5 = ceil(60 / 2) + 5 = 30 + 5 = 35 mins
      const result = ETAService.calculateETA(5, {
        avgServiceTimeMins: 15,
        serviceCapacityUnits: 2,
        etaBufferMins: 5,
        almostYourTurnThreshold: 10,
      });

      expect(result.estimatedWaitMins).toBe(35);
      expect(result.isAlmostYourTurn).toBe(true); // peopleAhead = 4 <= threshold 10
      expect(result.peopleAhead).toBe(4);
    });

    it('identifies "almost your turn" when estimated wait is within threshold or people ahead <= threshold', () => {
      // position = 2 (1 person ahead): ceil((1 * 15)/2) + 5 = ceil(7.5) + 5 = 8 + 5 = 13 mins, peopleAhead <= 10 => isAlmostYourTurn = true
      const result1 = ETAService.calculateETA(2, {
        avgServiceTimeMins: 15,
        serviceCapacityUnits: 2,
        etaBufferMins: 5,
        almostYourTurnThreshold: 10,
      });

      expect(result1.isAlmostYourTurn).toBe(true);

      // position = 1 (0 people ahead)
      const result0 = ETAService.calculateETA(1, {
        avgServiceTimeMins: 15,
        serviceCapacityUnits: 2,
        etaBufferMins: 5,
        almostYourTurnThreshold: 10,
      });

      expect(result0.estimatedWaitMins).toBe(5);
      expect(result0.isAlmostYourTurn).toBe(true);
    });
  });

  // ===========================================================================
  // 2. FSM QUEUE STATE MACHINE & OPERATIONAL TRANSITIONS
  // ===========================================================================
  describe('2. Queue FSM State Machine', () => {
    it('allows valid state transitions: WAITING -> NOTIFIED -> CALLED -> SEATED', async () => {
      const join = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Alice FSM',
        partySize: 2,
      });
      const entryId = join.entry.id;

      // WAITING -> NOTIFIED
      const notified = await QueueService.updateQueueStatus({ entryId, newStatus: 'NOTIFIED', actorUserId: TEST_ACTOR_ID });
      expect(notified.status).toBe('NOTIFIED');

      // NOTIFIED -> CALLED
      const called = await QueueService.updateQueueStatus({ entryId, newStatus: 'CALLED', actorUserId: TEST_ACTOR_ID });
      expect(called.status).toBe('CALLED');

      // CALLED -> SEATED (via seatQueueEntry)
      const seatResult = await QueueService.seatQueueEntry(entryId, tableSmallId, TEST_ACTOR_ID);
      expect(seatResult).toBeDefined();
      expect((seatResult as any).success).toBe(true);
      expect((seatResult as any).queueEntryId).toBe(entryId);
    });

    it('rejects invalid state transitions (e.g., SEATED -> WAITING)', async () => {
      const join = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Bob Invalid',
        partySize: 2,
      });
      const entryId = join.entry.id;

      await QueueService.seatQueueEntry(entryId, tableSmallId, TEST_ACTOR_ID);

      // Try invalid transition SEATED -> WAITING
      await expect(
        QueueService.updateQueueStatus({ entryId, newStatus: 'WAITING', actorUserId: TEST_ACTOR_ID })
      ).rejects.toThrow(/INVALID_QUEUE_TRANSITION/i);
    });

    it('allows terminal transitions to CANCELLED or NO_SHOW from WAITING or CALLED', async () => {
      const joinCancel = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Charlie Cancel',
        partySize: 2,
      });
      const cancelled = await QueueService.updateQueueStatus({ entryId: joinCancel.entry.id, newStatus: 'CANCELLED', actorUserId: TEST_ACTOR_ID });
      expect(cancelled.status).toBe('CANCELLED');

      const joinNoShow = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Dave NoShow',
        partySize: 2,
      });
      // Must call customer before marking NO_SHOW
      await QueueService.updateQueueStatus({ entryId: joinNoShow.entry.id, newStatus: 'CALLED', actorUserId: TEST_ACTOR_ID });
      const noShow = await QueueService.updateQueueStatus({ entryId: joinNoShow.entry.id, newStatus: 'NO_SHOW', actorUserId: TEST_ACTOR_ID });
      expect(noShow.status).toBe('NO_SHOW');
    });
  });

  // ===========================================================================
  // 3. ATOMIC SEATING & CAPACITY VALIDATION
  // ===========================================================================
  describe('3. Atomic Seating & Table Capacity Matching', () => {
    it('prevents seating party at a table with capacity < partySize', async () => {
      const joinLargeParty = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Large Family',
        partySize: 6,
      });

      // Small table T-01 has capacity 2, partySize is 6
      await expect(
        QueueService.seatQueueEntry(joinLargeParty.entry.id, tableSmallId, TEST_ACTOR_ID)
      ).rejects.toThrow(/INSUFFICIENT_TABLE_CAPACITY/i);
    });

    it('filters seatable tables by capacity >= partySize and status AVAILABLE', async () => {
      // Set tableSmallId to CLEANING temporarily
      await client.query("UPDATE public.restaurant_tables SET status = 'CLEANING' WHERE id = $1;", [tableSmallId]);

      // Query available tables for party of 3
      const tablesFor3 = await QueueService.getSeatableTables(RESTAURANT_ID, 3);
      // Small table (capacity 2, status CLEANING) is excluded.
      // Medium table (capacity 4, AVAILABLE) is included.
      // Large table (capacity 8, AVAILABLE) is included.
      expect(tablesFor3.map(t => t.id)).not.toContain(tableSmallId);
      expect(tablesFor3.map(t => t.id)).toContain(tableMediumId);
      expect(tablesFor3.map(t => t.id)).toContain(tableLargeId);
    });

    it('atomic seating locks both queue entry and table atomically', async () => {
      const joinParty = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Eve Atomic',
        partySize: 4,
      });

      const result = await QueueService.seatQueueEntry(joinParty.entry.id, tableMediumId, TEST_ACTOR_ID);
      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);

      // Check table is now OCCUPIED
      const tableRes = await client.query('SELECT status FROM public.restaurant_tables WHERE id = $1', [tableMediumId]);
      expect(tableRes.rows[0].status).toBe('OCCUPIED');

      // Attempting to seat another party at the now OCCUPIED tableMediumId must fail
      const joinParty2 = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Frank Second',
        partySize: 4,
      });

      await expect(
        QueueService.seatQueueEntry(joinParty2.entry.id, tableMediumId, TEST_ACTOR_ID)
      ).rejects.toThrow(/TABLE_NOT_AVAILABLE/i);
    });
  });

  // ===========================================================================
  // 4. CROSS-TENANT SECURITY ISOLATION
  // ===========================================================================
  describe('4. Cross-Tenant Security Isolation', () => {
    it('prevents seating a queue entry belonging to Restaurant A at a table in Restaurant B', async () => {
      // Create a table in OTHER_RESTAURANT_ID
      const otherTableRes = await client.query(`
        INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
        VALUES ($1, 'T-100', 4, 'AVAILABLE')
        RETURNING id;
      `, [OTHER_RESTAURANT_ID]);
      const otherTableId = otherTableRes.rows[0].id;

      // Customer joins RESTAURANT_ID
      const join = await QueueService.joinQueue({
        restaurantId: RESTAURANT_ID,
        customerName: 'Grace TenantA',
        partySize: 2,
      });

      // Try seating customer from RESTAURANT_ID at table in OTHER_RESTAURANT_ID
      await expect(
        QueueService.seatQueueEntry(join.entry.id, otherTableId, TEST_ACTOR_ID)
      ).rejects.toThrow(/TENANT_MISMATCH/i);
    });
  });
});

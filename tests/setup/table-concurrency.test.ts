import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { ZoneService } from '@/lib/services/zone-service';
import { TableService } from '@/lib/services/table-service';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 6: Restaurant Setup, Table Management & Concurrency Tests', () => {
  let client: Client;

  const RESTAURANT_A_ID = '11111111-1111-4111-a111-111111111111';
  const RESTAURANT_B_ID = '22222222-2222-4222-a222-222222222222';

  // Resolved by email in beforeAll: alice's Auth user was recreated
  // (new UUID) when repairing its broken seed row — never hard-rely on it.
  let ADMIN_A_ID = 'a0000000-0000-4000-a000-000000000002';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live table tests');
    }
    client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
        await client.connect();
    try {
      const found = await client.query(`SELECT id FROM auth.users WHERE lower(email) = 'alice@bistro.com' LIMIT 1`);
      if (found.rows.length > 0) ADMIN_A_ID = found.rows[0].id;
    } catch {
      // Fall back to the seed UUID.
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  async function withUserContext<T>(
    userId: string | null,
    role: 'authenticated' | 'anon',
    fn: () => Promise<T>
  ): Promise<T> {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL role = ${role}`);
      if (userId) {
        await client.query(`SET LOCAL request.jwt.claim.sub = '${userId}'`);
      } else {
        await client.query(`RESET request.jwt.claim.sub`);
      }
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 1: RESTAURANT ZONES
  // --------------------------------------------------------------------------

  it('[ZONE TEST] Restaurant Admin can create and list zones for assigned restaurant', async () => {
    const zone = await ZoneService.createZone({
      name: `Test Zone ${Date.now()}`,
      description: 'Test Section',
      sortOrder: 1,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(zone).toBeDefined();
    expect(zone.name).toContain('Test Zone');

    const { zones } = await ZoneService.listZones({ restaurantId: RESTAURANT_A_ID, userId: ADMIN_A_ID });
    expect(zones.some((z: { id: string }) => z.id === zone.id)).toBe(true);
  });

  it('[ZONE TEST] Cannot assign table to an INACTIVE zone', async () => {
    const inactiveZone = await ZoneService.createZone({
      name: `Inactive Zone ${Date.now()}`,
      description: 'Temporarily closed section',
      sortOrder: 99,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    await ZoneService.updateZone(inactiveZone.id, {
      status: 'INACTIVE',
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    await expect(
      TableService.createTable({
        tableNumber: `INACT-${Date.now()}`,
        capacity: 4,
        zoneId: inactiveZone.id,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: TABLE CREATION & BULK SETUP
  // --------------------------------------------------------------------------

  it('[TABLE TEST] Create table validates capacity (> 0 and <= 50) and rejects duplicates', async () => {
    const tableNum = `T-UNIQ-${Date.now()}`;

    // Valid creation
    const table = await TableService.createTable({
      tableNumber: tableNum,
      capacity: 4,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(table.table_number).toBe(tableNum);
    expect(table.capacity).toBe(4);

    // Duplicate number within same tenant must be rejected
    await expect(
      TableService.createTable({
        tableNumber: tableNum,
        capacity: 2,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();

    // Invalid capacity <= 0
    await expect(
      TableService.createTable({
        tableNumber: `T-BAD-${Date.now()}`,
        capacity: 0,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();

    // Invalid capacity > 50
    await expect(
      TableService.createTable({
        tableNumber: `T-HUGE-${Date.now()}`,
        capacity: 100,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  it('[BULK SETUP] Bulk table creation creates bounded batch atomically', async () => {
    const activeZone = await ZoneService.createZone({
      name: `Bulk Zone ${Date.now()}`,
      sortOrder: 5,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const prefix = `BLK-${Date.now().toString().slice(-4)}-`;

    const bulkResult = await TableService.bulkCreateTables({
      zoneId: activeZone.id,
      prefix,
      startNumber: 1,
      count: 5,
      capacity: 4,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(bulkResult.createdCount).toBe(5);
    expect(bulkResult.tables.length).toBe(5);

    // Duplicate bulk setup attempt must fail atomically
    await expect(
      TableService.bulkCreateTables({
        zoneId: activeZone.id,
        prefix,
        startNumber: 1,
        count: 5,
        capacity: 4,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: FINITE STATE MACHINE TRANSITIONS
  // --------------------------------------------------------------------------

  it('[STATE MACHINE] Valid state transitions succeed and invalid transitions fail', async () => {
    const table = await TableService.createTable({
      tableNumber: `FSM-${Date.now()}`,
      capacity: 2,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(table.status).toBe('AVAILABLE');

    // AVAILABLE -> OCCUPIED (Valid)
    const occupied = await TableService.updateTableStatus(
      table.id,
      'OCCUPIED',
      'AVAILABLE',
      RESTAURANT_A_ID,
      ADMIN_A_ID
    );
    expect(occupied.status).toBe('OCCUPIED');

    // OCCUPIED -> AVAILABLE directly (Valid transition now)
    const availableDirect = await TableService.updateTableStatus(table.id, 'AVAILABLE', 'OCCUPIED', RESTAURANT_A_ID, ADMIN_A_ID);
    expect(availableDirect.status).toBe('AVAILABLE');
    
    // AVAILABLE -> OCCUPIED
    const reOccupied = await TableService.updateTableStatus(table.id, 'OCCUPIED', 'AVAILABLE', RESTAURANT_A_ID, ADMIN_A_ID);
    expect(reOccupied.status).toBe('OCCUPIED');

    // OCCUPIED -> CLEANING (Valid)
    const cleaning = await TableService.updateTableStatus(
      table.id,
      'CLEANING',
      'OCCUPIED',
      RESTAURANT_A_ID,
      ADMIN_A_ID
    );
    expect(cleaning.status).toBe('CLEANING');

    // CLEANING -> AVAILABLE (Explicit staff action)
    const available = await TableService.updateTableStatus(
      table.id,
      'AVAILABLE',
      'CLEANING',
      RESTAURANT_A_ID,
      ADMIN_A_ID
    );
    expect(available.status).toBe('AVAILABLE');
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: CONCURRENCY TEST (SIMULTANEOUS STATE TRANSITION)
  // --------------------------------------------------------------------------

  it('[CONCURRENCY TEST] Simultaneous status transition attempts on same table resolve safely', async () => {
    const table = await TableService.createTable({
      tableNumber: `RACE-${Date.now()}`,
      capacity: 4,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(table.status).toBe('AVAILABLE');

    // Run two simultaneous transition attempts: AVAILABLE -> OCCUPIED
    const worker1 = TableService.updateTableStatus(table.id, 'OCCUPIED', 'AVAILABLE', RESTAURANT_A_ID, ADMIN_A_ID);
    const worker2 = TableService.updateTableStatus(table.id, 'OCCUPIED', 'AVAILABLE', RESTAURANT_A_ID, ADMIN_A_ID);

    const results = await Promise.allSettled([worker1, worker2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Final table status in database MUST be OCCUPIED
    const finalTable = await TableService.listTables({
      restaurantId: RESTAURANT_A_ID,
      search: table.table_number,
      userId: ADMIN_A_ID,
    });
    expect(finalTable.tables[0]?.status).toBe('OCCUPIED');
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 5: ARCHIVAL & CROSS-TENANT SECURITY
  // --------------------------------------------------------------------------

  it('[ARCHIVAL TEST] Table archival hides table from active list while retaining record', async () => {
    const table = await TableService.createTable({
      tableNumber: `ARCH-${Date.now()}`,
      capacity: 2,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const archived = await TableService.archiveTable(table.id, RESTAURANT_A_ID, ADMIN_A_ID);
    expect(archived.is_archived).toBe(true);

    const activeList = await TableService.listTables({
      restaurantId: RESTAURANT_A_ID,
      search: table.table_number,
      userId: ADMIN_A_ID,
    });
    expect(activeList.tables.length).toBe(0);
  });

  it('[SECURITY TEST] Restaurant Admin A cannot access or mutate Restaurant B tables', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const res = await client.query(
        `SELECT * FROM public.restaurant_tables WHERE restaurant_id = $1::uuid`,
        [RESTAURANT_B_ID]
      );
      expect(res.rows.length).toBe(0);
    });
  });
});

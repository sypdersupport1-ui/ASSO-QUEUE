import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Live Database RLS Multi-Tenant Security & Penetration Tests', () => {
  let client: Client;

  const RESTAURANT_B_ID = '22222222-2222-4222-a222-222222222222';

  // Resolved by email in beforeAll: the super-admin Auth user may have been
  // recreated (new UUID) since seeding, so never hard-rely on the seed id.
  let SUPER_ADMIN_ID = 'a0000000-0000-4000-a000-000000000001';
  // Resolved by email in beforeAll: alice's Auth user was recreated
  // (new UUID) when repairing its broken seed row — never hard-rely on it.
  let ADMIN_A_ID = 'a0000000-0000-4000-a000-000000000002';
  const STAFF_A_ID = 'a0000000-0000-4000-a000-000000000004';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for database tests');
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
    try {
      const found = await client.query(`SELECT id FROM auth.users WHERE lower(email) = 'superadmin@queueflow.io' LIMIT 1`);
      if (found.rows.length > 0) SUPER_ADMIN_ID = found.rows[0].id;
    } catch {
      // Fall back to the seed UUID.
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  /**
   * Helper to set authenticated user context inside a PostgreSQL transaction.
   */
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
  // TEST SUITE 1: RESTAURANT ADMIN TENANT ISOLATION
  // --------------------------------------------------------------------------

  it('[PENETRATION TEST] Restaurant Admin A cannot SELECT Restaurant B tables', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const res = await client.query(
        'SELECT * FROM public.restaurant_tables WHERE restaurant_id = $1',
        [RESTAURANT_B_ID]
      );
      expect(res.rows.length).toBe(0);
    });
  });

  it('[PENETRATION TEST] Restaurant Admin A cannot INSERT tables into Restaurant B', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      await expect(
        client.query(
          `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
           VALUES ($1, 'ILLEGAL-01', 4, 'AVAILABLE')`,
          [RESTAURANT_B_ID]
        )
      ).rejects.toThrow();
    });
  });

  it('[PENETRATION TEST] Restaurant Admin A cannot UPDATE Restaurant B tables', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const updateRes = await client.query(
        `UPDATE public.restaurant_tables SET status = 'BLOCKED' WHERE restaurant_id = $1`,
        [RESTAURANT_B_ID]
      );
      expect(updateRes.rowCount).toBe(0);
    });
  });

  it('[PENETRATION TEST] Restaurant Admin A cannot DELETE Restaurant B tables', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const deleteRes = await client.query(
        `DELETE FROM public.restaurant_tables WHERE restaurant_id = $1`,
        [RESTAURANT_B_ID]
      );
      expect(deleteRes.rowCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: STAFF TENANT ISOLATION
  // --------------------------------------------------------------------------

  it('[PENETRATION TEST] Staff A cannot SELECT Restaurant B queue entries or orders', async () => {
    await withUserContext(STAFF_A_ID, 'authenticated', async () => {
      const resQueue = await client.query(
        'SELECT * FROM public.queue_entries WHERE restaurant_id = $1',
        [RESTAURANT_B_ID]
      );
      expect(resQueue.rows.length).toBe(0);

      const resOrders = await client.query(
        'SELECT * FROM public.orders WHERE restaurant_id = $1',
        [RESTAURANT_B_ID]
      );
      expect(resOrders.rows.length).toBe(0);
    });
  });

  it('[PENETRATION TEST] Staff A cannot INSERT queue entries into Restaurant B', async () => {
    await withUserContext(STAFF_A_ID, 'authenticated', async () => {
      await expect(
        client.query(
          `INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, queue_number, status)
           VALUES ($1, 'Illegal Guest', 2, 999, 'WAITING')`,
          [RESTAURANT_B_ID]
        )
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: ANONYMOUS CUSTOMER DIRECT DATABASE ACCESS
  // --------------------------------------------------------------------------

  it('[PENETRATION TEST] Anonymous client cannot SELECT protected domain tables directly', async () => {
    await withUserContext(null, 'anon', async () => {
      const resRestaurants = await client.query('SELECT * FROM public.restaurants');
      expect(resRestaurants.rows.length).toBe(0);

      const resTables = await client.query('SELECT * FROM public.restaurant_tables');
      expect(resTables.rows.length).toBe(0);

      const resOrders = await client.query('SELECT * FROM public.orders');
      expect(resOrders.rows.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: SUPER ADMIN PLATFORM-WIDE ACCESS
  // --------------------------------------------------------------------------

  it('Super Admin can SELECT data across all restaurants', async () => {
    await withUserContext(SUPER_ADMIN_ID, 'authenticated', async () => {
      const res = await client.query('SELECT * FROM public.restaurants');
      expect(res.rows.length).toBeGreaterThanOrEqual(2);
    });
  });
});

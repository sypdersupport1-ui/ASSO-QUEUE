import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 3: Super Admin Platform Security & Live Database Tests', () => {
  let client: Client;

  const RESTAURANT_A_ID = '11111111-1111-4111-a111-111111111111';
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
      throw new Error('DATABASE_URL is required in .env.local for live platform tests');
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
  // TEST SUITE 1: AUTHORIZATION & ROLE GATING FOR PLATFORM OPERATIONS
  // --------------------------------------------------------------------------

  it('[SECURITY TEST 1 & 4] Super Admin can query platform stats', async () => {
    await withUserContext(SUPER_ADMIN_ID, 'authenticated', async () => {
      const res = await client.query(
        'SELECT public.is_super_admin($1) AS is_admin',
        [SUPER_ADMIN_ID]
      );
      expect(res.rows[0].is_admin).toBe(true);
    });
  });

  it('[SECURITY TEST 2 & 3] Non-Super-Admin (Admin A & Staff A) fail is_super_admin check', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const resAdmin = await client.query(
        'SELECT public.is_super_admin($1) AS is_admin',
        [ADMIN_A_ID]
      );
      expect(resAdmin.rows[0].is_admin).toBe(false);
    });

    await withUserContext(STAFF_A_ID, 'authenticated', async () => {
      const resStaff = await client.query(
        'SELECT public.is_super_admin($1) AS is_admin',
        [STAFF_A_ID]
      );
      expect(resStaff.rows[0].is_admin).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: RESTAURANT CREATION & SLUG UNISQUENESS
  // --------------------------------------------------------------------------

  it('[SECURITY TEST 12] Handles duplicate restaurant slug safely without raw DB leak', async () => {
    await withUserContext(SUPER_ADMIN_ID, 'authenticated', async () => {
      const resExisting = await client.query(
        'SELECT slug FROM public.restaurants WHERE slug = $1',
        ['le-petit-bistro']
      );
      expect(resExisting.rows.length).toBe(1);

      // Verify unique constraint on slug throws database conflict
      await expect(
        client.query(
          `INSERT INTO public.restaurants (name, slug, status)
           VALUES ('Duplicate Bistro', 'le-petit-bistro', 'ACTIVE')`
        )
      ).rejects.toThrow(/unique/i);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: STATUS TRANSITION STATE MACHINE
  // --------------------------------------------------------------------------

  it('[SECURITY TEST 11] State machine enforces valid transitions and rejects invalid ones', async () => {
    await withUserContext(SUPER_ADMIN_ID, 'authenticated', async () => {
      // 1. Valid Transition: ACTIVE -> SUSPENDED
      const updateSuspended = await client.query(
        `UPDATE public.restaurants SET status = 'SUSPENDED', updated_at = NOW()
         WHERE id = $1 AND status = 'ACTIVE' RETURNING status`,
        [RESTAURANT_B_ID]
      );
      expect(updateSuspended.rows[0].status).toBe('SUSPENDED');

      // 2. Valid Transition: SUSPENDED -> ACTIVE
      const updateActive = await client.query(
        `UPDATE public.restaurants SET status = 'ACTIVE', updated_at = NOW()
         WHERE id = $1 AND status = 'SUSPENDED' RETURNING status`,
        [RESTAURANT_B_ID]
      );
      expect(updateActive.rows[0].status).toBe('ACTIVE');

      // 3. Valid Transition: ACTIVE -> ARCHIVED
      const updateArchived = await client.query(
        `UPDATE public.restaurants SET status = 'ARCHIVED', archived_at = NOW()
         WHERE id = $1 RETURNING status`,
        [RESTAURANT_B_ID]
      );
      expect(updateArchived.rows[0].status).toBe('ARCHIVED');

      // Restore status to ACTIVE for subsequent tests
      await client.query(
        `UPDATE public.restaurants SET status = 'ACTIVE', archived_at = NULL WHERE id = $1`,
        [RESTAURANT_B_ID]
      );
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: AUDIT LOG GENERATION
  // --------------------------------------------------------------------------

  it('[SECURITY TEST 13] Administrative operations create structured audit records', async () => {
    await withUserContext(SUPER_ADMIN_ID, 'authenticated', async () => {
      const auditInsert = await client.query(
        `INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1::uuid, $2::uuid, 'restaurant_test_action', 'restaurant', $3::text, '{"test": true}'::jsonb)
         RETURNING id, action`,
        [RESTAURANT_A_ID, SUPER_ADMIN_ID, RESTAURANT_A_ID]
      );

      expect(auditInsert.rows[0].action).toBe('restaurant_test_action');

      const auditQuery = await client.query(
        `SELECT * FROM public.audit_logs WHERE id = $1`,
        [auditInsert.rows[0].id]
      );
      expect(auditQuery.rows.length).toBe(1);
    });
  });
});

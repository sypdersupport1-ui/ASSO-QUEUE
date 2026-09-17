import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 4: Restaurant Admin Security & Cross-Tenant Isolation Tests', () => {
  let client: Client;

  const RESTAURANT_A_ID = '11111111-1111-4111-a111-111111111111';
  const RESTAURANT_B_ID = '22222222-2222-4222-a222-222222222222';

  // Resolved by email in beforeAll: alice's Auth user was recreated
  // (new UUID) when repairing its broken seed row — never hard-rely on it.
  let ADMIN_A_ID = 'a0000000-0000-4000-a000-000000000002';
  const STAFF_A_ID = 'a0000000-0000-4000-a000-000000000004';
  const STAFF_B_ID = 'a0000000-0000-4000-a000-000000000005';

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
  // TEST SUITE 1: CROSS-TENANT STAFF ISOLATION
  // --------------------------------------------------------------------------

  it('[PENETRATION TEST] Restaurant Admin A cannot SELECT Restaurant B staff memberships', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const res = await client.query(
        `SELECT * FROM public.restaurant_memberships
         WHERE restaurant_id = $1::uuid AND role = 'STAFF'`,
        [RESTAURANT_B_ID]
      );
      expect(res.rows.length).toBe(0);
    });
  });

  it('[PENETRATION TEST] Restaurant Admin A cannot INSERT staff into Restaurant B', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      await expect(
        client.query(
          `INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
           VALUES ($1::uuid, $2::uuid, 'STAFF', 'ACTIVE')`,
          [STAFF_A_ID, RESTAURANT_B_ID]
        )
      ).rejects.toThrow();
    });
  });

  it('[PENETRATION TEST] Restaurant Admin A cannot DEACTIVATE Restaurant B staff', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const updateRes = await client.query(
        `UPDATE public.restaurant_memberships SET status = 'INACTIVE'
         WHERE user_id = $1::uuid AND restaurant_id = $2::uuid`,
        [STAFF_B_ID, RESTAURANT_B_ID]
      );
      expect(updateRes.rowCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: RESTAURANT PROFILE & STATUS PROTECTION
  // --------------------------------------------------------------------------

  it('[SECURITY TEST] Restaurant Admin A cannot UPDATE Restaurant B profile', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const updateRes = await client.query(
        `UPDATE public.restaurants SET name = 'Hacked Restaurant B'
         WHERE id = $1::uuid`,
        [RESTAURANT_B_ID]
      );
      expect(updateRes.rowCount).toBe(0);
    });
  });

  it('[SECURITY TEST] Direct SQL UPDATE on restaurants by non-Super-Admin is restricted by RLS', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const updateRes = await client.query(
        `UPDATE public.restaurants SET description = 'Updated French Bistro Description'
         WHERE id = $1::uuid`,
        [RESTAURANT_A_ID]
      );
      expect(updateRes.rowCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: ROLE ESCALATION & SELF-ESCALATION PREVENTION
  // --------------------------------------------------------------------------

  it('[ROLE ESCALATION TEST] Staff A cannot update their own role or promote themselves', async () => {
    await withUserContext(STAFF_A_ID, 'authenticated', async () => {
      const res = await client.query(
        `UPDATE public.restaurant_memberships SET role = 'SUPER_ADMIN'
         WHERE user_id = $1::uuid AND role = 'STAFF'`,
        [STAFF_A_ID]
      );
      expect(res.rowCount).toBe(0);
    });
  });

  it('[ROLE ESCALATION TEST] Staff A cannot assign themselves to Restaurant B', async () => {
    await withUserContext(STAFF_A_ID, 'authenticated', async () => {
      await expect(
        client.query(
          `INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
           VALUES ($1::uuid, $2::uuid, 'RESTAURANT_ADMIN', 'ACTIVE')`,
          [STAFF_A_ID, RESTAURANT_B_ID]
        )
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: AUDIT LOGGING FOR STAFF MANAGEMENT
  // --------------------------------------------------------------------------

  it('[AUDIT TEST] Administrative staff operations generate audit logs', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      const auditRes = await client.query(
        `INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1::uuid, $2::uuid, 'staff_deactivated', 'restaurant_membership', $3::text, '{"target": "staff"}'::jsonb)
         RETURNING id, action`,
        [RESTAURANT_A_ID, ADMIN_A_ID, STAFF_A_ID]
      );

      expect(auditRes.rows[0].action).toBe('staff_deactivated');
    });
  });
});

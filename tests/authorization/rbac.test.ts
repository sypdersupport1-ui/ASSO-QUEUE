import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS, PermissionKey } from '@/lib/auth/permissions';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 5: Granular RBAC, Permission System & Security Tests', () => {
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
      throw new Error('DATABASE_URL is required in .env.local for live authorization tests');
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
  // TEST SUITE 1: SUPER ADMIN PERMISSIONS
  // --------------------------------------------------------------------------

  it('[SUPER ADMIN] Super Admin is authorized for all platform and restaurant permissions', async () => {
    const canPlatformView = await AuthorizationService.hasPermission({
      userId: SUPER_ADMIN_ID,
      permission: PERMISSIONS.PLATFORM_VIEW,
    });
    const canCreateRestaurant = await AuthorizationService.hasPermission({
      userId: SUPER_ADMIN_ID,
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_CREATE,
    });
    const canAuditView = await AuthorizationService.hasPermission({
      userId: SUPER_ADMIN_ID,
      permission: PERMISSIONS.PLATFORM_AUDIT_VIEW,
    });

    expect(canPlatformView).toBe(true);
    expect(canCreateRestaurant).toBe(true);
    expect(canAuditView).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: RESTAURANT ADMIN PERMISSIONS & BOUNDARIES
  // --------------------------------------------------------------------------

  it('[RESTAURANT ADMIN] Restaurant Admin has restaurant & staff permissions for own restaurant', async () => {
    const canView = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.RESTAURANT_VIEW,
    });
    const canUpdate = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.RESTAURANT_UPDATE,
    });
    const canCreateStaff = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.STAFF_CREATE,
    });

    expect(canView).toBe(true);
    expect(canUpdate).toBe(true);
    expect(canCreateStaff).toBe(true);
  });

  it('[SECURITY TEST] Restaurant Admin is DENIED all platform.* permissions', async () => {
    const canPlatformView = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      permission: PERMISSIONS.PLATFORM_VIEW,
    });
    const canCreateRestaurant = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_CREATE,
    });
    const canLifecycle = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_LIFECYCLE,
    });

    expect(canPlatformView).toBe(false);
    expect(canCreateRestaurant).toBe(false);
    expect(canLifecycle).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: STAFF PERMISSIONS & MINIMUM ACCESS
  // --------------------------------------------------------------------------

  it('[STAFF] Staff member holds minimum operational permissions only', async () => {
    const canViewQueue = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.QUEUE_VIEW,
    });
    const canManageQueue = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.QUEUE_MANAGE,
    });
    const canViewTables = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.TABLES_VIEW,
    });

    expect(canViewQueue).toBe(true);
    expect(canManageQueue).toBe(true);
    expect(canViewTables).toBe(true);
  });

  it('[SECURITY TEST] Staff member is DENIED administrative & management permissions', async () => {
    const canCreateStaff = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.STAFF_CREATE,
    });
    const canDeactivateStaff = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.STAFF_DEACTIVATE,
    });
    const canUpdateProfile = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.RESTAURANT_UPDATE,
    });
    const canExportAnalytics = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.ANALYTICS_EXPORT,
    });

    expect(canCreateStaff).toBe(false);
    expect(canDeactivateStaff).toBe(false);
    expect(canUpdateProfile).toBe(false);
    expect(canExportAnalytics).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: INACTIVE MEMBERSHIP DENIAL
  // --------------------------------------------------------------------------

  it('[INACTIVE MEMBERSHIP TEST] Inactive staff membership is DENIED authorization', async () => {
    // Create temporary inactive staff membership in DB for testing
    const inactiveUserId = 'a0000000-0000-4000-a000-000000000099';
    await client.query(`
      INSERT INTO auth.users (id, instance_id, email, aud, role)
      VALUES ('${inactiveUserId}', '00000000-0000-0000-0000-000000000000', 'inactive@test.com', 'authenticated', 'authenticated')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, display_name, email)
      VALUES ('${inactiveUserId}', 'Inactive Test User', 'inactive@test.com')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
      VALUES ('${inactiveUserId}', '${RESTAURANT_A_ID}', 'STAFF', 'INACTIVE')
      ON CONFLICT (user_id, restaurant_id, role) DO UPDATE SET status = 'INACTIVE';
    `);

    const canViewQueue = await AuthorizationService.hasPermission({
      userId: inactiveUserId,
      restaurantId: RESTAURANT_A_ID,
      permission: PERMISSIONS.QUEUE_VIEW,
    });

    expect(canViewQueue).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 5: CROSS-TENANT ISOLATION
  // --------------------------------------------------------------------------

  it('[CROSS-TENANT] Restaurant Admin A is DENIED access for Restaurant B', async () => {
    const canViewB = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      restaurantId: RESTAURANT_B_ID,
      permission: PERMISSIONS.RESTAURANT_VIEW,
    });
    const canCreateStaffB = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      restaurantId: RESTAURANT_B_ID,
      permission: PERMISSIONS.STAFF_CREATE,
    });

    expect(canViewB).toBe(false);
    expect(canCreateStaffB).toBe(false);
  });

  it('[CROSS-TENANT] Staff A is DENIED operational access for Restaurant B', async () => {
    const canViewQueueB = await AuthorizationService.hasPermission({
      userId: STAFF_A_ID,
      restaurantId: RESTAURANT_B_ID,
      permission: PERMISSIONS.QUEUE_VIEW,
    });

    expect(canViewQueueB).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 6: FAIL-CLOSED & DATABASE RLS PROTECTION
  // --------------------------------------------------------------------------

  it('[FAIL-CLOSED] Unknown permission key returns false', async () => {
    const result = await AuthorizationService.hasPermission({
      userId: ADMIN_A_ID,
      restaurantId: RESTAURANT_A_ID,
      permission: 'invalid.unknown_permission' as PermissionKey,
    });
    expect(result).toBe(false);
  });

  it('[SECURITY TEST] Direct SQL INSERT into permissions catalog by non-Super-Admin fails', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      await expect(
        client.query(
          `INSERT INTO public.permissions (key, domain, description)
           VALUES ('hacked.permission', 'PLATFORM', 'Unauthorized injection')`
        )
      ).rejects.toThrow();
    });
  });

  it('[SECURITY TEST] Direct SQL INSERT into role_permissions by non-Super-Admin fails', async () => {
    await withUserContext(STAFF_A_ID, 'authenticated', async () => {
      const permRes = await client.query(`SELECT id FROM public.permissions LIMIT 1`);
      const permId = permRes.rows[0].id;
      await expect(
        client.query(
          `INSERT INTO public.role_permissions (role, permission_id)
           VALUES ('STAFF', '${permId}')`
        )
      ).rejects.toThrow();
    });
  });
});

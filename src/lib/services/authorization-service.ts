import 'server-only';
import { cache } from 'react';

import { createAdminClient } from '@/lib/db/supabase/admin';
import { requireAuth } from '@/lib/auth/session';
import { AuthorizationError } from '@/lib/errors';
import { PERMISSIONS, PermissionKey, ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';
import { logger } from '@/lib/logging/logger';

export interface AuthorizeOptions {
  userId?: string;
  restaurantId?: string;
  permission: PermissionKey;
}

export interface EffectivePermissionsOptions {
  userId?: string;
  restaurantId?: string;
}

export interface AuthorizedContext {
  userId: string;
  role: 'SUPER_ADMIN' | 'RESTAURANT_ADMIN' | 'STAFF';
  restaurantId?: string;
  membershipId?: string;
}

// ---------------------------------------------------------------------------
// Internal per-request memoized helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a user's active membership and super-admin status in one DB round-trip,
 * memoized per React request via cache(). All permission checks share this result
 * within a single server action / render.
 */
const _resolveUserMembership = cache(
  async (
    userId: string,
    restaurantId?: string
  ): Promise<{
    isSuperAdmin: boolean;
    superAdminMembershipId?: string;
    activeMembership?: {
      id: string;
      restaurant_id: string;
      role: string;
      status: string;
    };
  }> => {
    const adminClient = createAdminClient();

    // Single query: fetch all active memberships for this user (optionally scoped by restaurant)
    const query = adminClient
      .from('restaurant_memberships')
      .select('id, restaurant_id, role, status')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE');

    if (restaurantId) {
      // For restaurant-scoped checks we want both SUPER_ADMIN (any restaurant) and the specific restaurant membership
      // We achieve this by not filtering by restaurant_id on the first pass if we also need super admin.
      // Instead: fetch all active memberships and check locally.
    }

    const { data: memberships } = await query;

    if (!memberships || memberships.length === 0) {
      return { isSuperAdmin: false };
    }

    const superAdmin = memberships.find((m) => m.role === 'SUPER_ADMIN');
    if (superAdmin) {
      return { isSuperAdmin: true, superAdminMembershipId: superAdmin.id };
    }

    // Find the relevant active membership for the restaurant
    const activeMembership = restaurantId
      ? memberships.find((m) => m.restaurant_id === restaurantId && m.status === 'ACTIVE')
      : memberships.find((m) => m.status === 'ACTIVE');

    return {
      isSuperAdmin: false,
      activeMembership: activeMembership ?? undefined,
    };
  }
);

/**
 * Resolves permission overrides and role permissions for a membership, memoized per request.
 */
const _resolvePermissionForMembership = cache(
  async (
    membershipId: string,
    membershipRole: string,
    permission: PermissionKey
  ): Promise<boolean | null> => {
    const adminClient = createAdminClient();

    // Run both override check and role permission check in parallel
    const [overrideRes, rolePermRes] = await Promise.all([
      adminClient
        .from('staff_permission_overrides')
        .select('effect, permissions!inner(key)')
        .eq('membership_id', membershipId)
        .eq('permissions.key', permission)
        .maybeSingle(),
      adminClient
        .from('role_permissions')
        .select('id, permissions!inner(key)')
        .eq('role', membershipRole)
        .eq('permissions.key', permission)
        .maybeSingle(),
    ]);

    // Explicit DENY overrides everything
    if (overrideRes.data?.effect === 'DENY') return false;
    // Explicit ALLOW override
    if (overrideRes.data?.effect === 'ALLOW') return true;
    // Role-based permission
    if (rolePermRes.data) return true;

    // null = not found in DB, caller should check fallback matrix
    return null;
  }
);

// ---------------------------------------------------------------------------
// AuthorizationService
// ---------------------------------------------------------------------------

export class AuthorizationService {
  /**
   * Evaluates if a user holds a specific permission in a given tenant context.
   * Deny-by-default model.
   *
   * PERFORMANCE: Uses per-request memoized helpers so repeated calls within the
   * same server action share DB results — no redundant round-trips.
   */
  static async hasPermission(options: AuthorizeOptions): Promise<boolean> {
    try {
      let targetUserId = options.userId;

      if (!targetUserId) {
        const authUser = await requireAuth(); // already memoized via cache()
        targetUserId = authUser.id;
      }

      if (!targetUserId) {
        return false;
      }

      const { isSuperAdmin, activeMembership } = await _resolveUserMembership(
        targetUserId,
        options.restaurantId
      );

      if (isSuperAdmin) return true;

      // Non-Super-Admins CANNOT hold any platform.* permissions
      if (options.permission.startsWith('platform.')) return false;

      if (!activeMembership) {
        logger.info('Authorization denied for inactive/missing membership', {
          operation: 'hasPermission',
          userId: targetUserId,
          restaurantId: options.restaurantId,
          permission: options.permission,
        });
        return false;
      }

      // Check DB permission matrix (parallel) — memoized per membership+permission pair
      const dbResult = await _resolvePermissionForMembership(
        activeMembership.id,
        activeMembership.role,
        options.permission
      );

      if (dbResult !== null) return dbResult;

      // Fallback: in-memory role matrix (used when DB tables are unseeded)
      const fallbackRolePermissions =
        ROLE_DEFAULT_PERMISSIONS[activeMembership.role as keyof typeof ROLE_DEFAULT_PERMISSIONS] || [];
      return fallbackRolePermissions.includes(options.permission);
    } catch (error) {
      logger.error('Error checking permission in AuthorizationService', {
        operation: 'hasPermission',
        error: error instanceof Error ? error.message : String(error),
        permission: options.permission,
      });
      return false;
    }
  }

  /**
   * Enforces permission requirement. Throws AuthorizationError if denied.
   *
   * PERFORMANCE: Reuses memoized membership data from hasPermission() — the second
   * DB query for context is eliminated by returning data from the shared cache.
   */
  static async requirePermission(options: AuthorizeOptions): Promise<AuthorizedContext> {
    let targetUserId = options.userId;

    if (!targetUserId) {
      const authUser = await requireAuth(); // memoized
      targetUserId = authUser.id;
    }

    // _resolveUserMembership is memoized — this is a cache hit if hasPermission() was already called
    const { isSuperAdmin, superAdminMembershipId, activeMembership } =
      await _resolveUserMembership(targetUserId, options.restaurantId);

    if (isSuperAdmin) {
      // Super admins can do everything — no further checks needed
      return {
        userId: targetUserId,
        role: 'SUPER_ADMIN',
        restaurantId: options.restaurantId,
        membershipId: superAdminMembershipId,
      };
    }

    // Non-Super-Admins CANNOT hold any platform.* permissions
    if (options.permission.startsWith('platform.')) {
      throw new AuthorizationError(
        `Permission denied. Required permission: ${options.permission}`
      );
    }

    if (!activeMembership) {
      throw new AuthorizationError('No active membership found for authorization context');
    }

    // Check DB permission matrix — memoized, cache hit if hasPermission() already called
    const dbResult = await _resolvePermissionForMembership(
      activeMembership.id,
      activeMembership.role,
      options.permission
    );

    let isAuthorized = dbResult;
    if (isAuthorized === null) {
      // Fallback: in-memory role matrix
      const fallbackRolePermissions =
        ROLE_DEFAULT_PERMISSIONS[activeMembership.role as keyof typeof ROLE_DEFAULT_PERMISSIONS] || [];
      isAuthorized = fallbackRolePermissions.includes(options.permission);
    }

    if (!isAuthorized) {
      throw new AuthorizationError(
        `Permission denied. Required permission: ${options.permission}`
      );
    }

    return {
      userId: targetUserId,
      role: activeMembership.role as 'RESTAURANT_ADMIN' | 'STAFF',
      restaurantId: activeMembership.restaurant_id,
      membershipId: activeMembership.id,
    };
  }

  /**
   * Resolves list of all effective permissions for a user in a tenant context.
   */
  static async getEffectivePermissions(options: EffectivePermissionsOptions): Promise<PermissionKey[]> {
    let targetUserId = options.userId;

    if (!targetUserId) {
      const authUser = await requireAuth(); // memoized
      targetUserId = authUser.id;
    }

    if (!targetUserId) {
      return [];
    }

    // Reuses memoized membership resolution
    const { isSuperAdmin, activeMembership } = await _resolveUserMembership(
      targetUserId,
      options.restaurantId
    );

    // 1. Super Admin holds all permissions
    if (isSuperAdmin) {
      return Object.values(PERMISSIONS);
    }

    if (!activeMembership) {
      return [];
    }

    const adminClient = createAdminClient();

    // 2. Query base role permissions + overrides in parallel
    const [rolePermsRes, overridesRes] = await Promise.all([
      adminClient
        .from('role_permissions')
        .select('permissions!inner(key)')
        .eq('role', activeMembership.role),
      adminClient
        .from('staff_permission_overrides')
        .select('effect, permissions!inner(key)')
        .eq('membership_id', activeMembership.id),
    ]);

    const basePermissions = new Set<PermissionKey>();

    if (rolePermsRes.data && rolePermsRes.data.length > 0) {
      for (const item of rolePermsRes.data) {
        const key = (item.permissions as unknown as { key: PermissionKey })?.key;
        if (key) basePermissions.add(key);
      }
    } else {
      const defaults =
        ROLE_DEFAULT_PERMISSIONS[activeMembership.role as keyof typeof ROLE_DEFAULT_PERMISSIONS] || [];
      defaults.forEach((k) => basePermissions.add(k));
    }

    // 3. Apply Staff Overrides
    if (overridesRes.data) {
      for (const ov of overridesRes.data) {
        const key = (ov.permissions as unknown as { key: PermissionKey })?.key;
        if (!key) continue;
        if (ov.effect === 'DENY') {
          basePermissions.delete(key);
        } else if (ov.effect === 'ALLOW') {
          basePermissions.add(key);
        }
      }
    }

    return Array.from(basePermissions);
  }
}

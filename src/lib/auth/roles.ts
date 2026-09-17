import 'server-only';
import { requireAuth } from './session';
import { AuthorizationError, DomainError } from '@/lib/errors';
import type { User } from '@supabase/supabase-js';

export type UserRole = 'SUPER_ADMIN' | 'RESTAURANT_ADMIN' | 'STAFF';

export interface UserRoleContext {
  userId: string;
  role: UserRole;
  restaurantId?: string;
}

/**
 * Require authenticated user helper (alias for requireAuth).
 */
export async function requireAuthenticatedUser(): Promise<User> {
  return await requireAuth();
}

/**
 * Extract user role from metadata or user claims.
 * (Foundation implementation - will be connected to RLS/User table in Phase 2).
 */
export function getUserRole(user: User): UserRole | null {
  const role = user.app_metadata?.role || user.user_metadata?.role;
  if (role === 'SUPER_ADMIN' || role === 'RESTAURANT_ADMIN' || role === 'STAFF') {
    return role as UserRole;
  }
  return null;
}

/**
 * Enforce role requirement for server operations.
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<UserRoleContext> {
  const user = await requireAuthenticatedUser();
  const role = getUserRole(user);

  if (!role || !allowedRoles.includes(role)) {
    throw new AuthorizationError(
      `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}`
    );
  }

  return {
    userId: user.id,
    role,
    restaurantId: user.user_metadata?.restaurant_id,
  };
}

/**
 * Foundation check for tenant/restaurant level authorization.
 * Full multi-tenant DB check will be activated in Phase 2.
 */
export async function requireRestaurantAccess(restaurantId: string): Promise<UserRoleContext> {
  if (!restaurantId) {
    throw new DomainError('Restaurant ID is required for access verification');
  }

  const userContext = await requireRole(['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'STAFF']);

  // Super Admin can access any tenant
  if (userContext.role === 'SUPER_ADMIN') {
    return userContext;
  }

  // Restaurant Admin / Staff must match tenant ID
  if (userContext.restaurantId !== restaurantId) {
    throw new AuthorizationError('Access denied for this restaurant tenant');
  }

  return userContext;
}

import 'server-only';

import { AuthorizationService } from '@/lib/services/authorization-service';
import { PermissionKey } from '@/lib/auth/permissions';

/**
 * Server-side UI authorization check helper.
 * Usage in Server Components:
 *   if (await can(PERMISSIONS.STAFF_CREATE, restaurantId)) { ... }
 */
export async function can(permission: PermissionKey, restaurantId?: string): Promise<boolean> {
  return await AuthorizationService.hasPermission({
    permission,
    restaurantId,
  });
}

/**
 * Returns a map of permission booleans for a set of permission keys in UI rendering.
 */
export async function getPermissionMap(
  permissions: PermissionKey[],
  restaurantId?: string
): Promise<Record<PermissionKey, boolean>> {
  const result: Partial<Record<PermissionKey, boolean>> = {};

  for (const perm of permissions) {
    result[perm] = await can(perm, restaurantId);
  }

  return result as Record<PermissionKey, boolean>;
}

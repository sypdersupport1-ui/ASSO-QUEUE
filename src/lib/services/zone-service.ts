import 'server-only';

import { createAdminClient } from '@/lib/db/supabase/admin';
import { requireAuth } from '@/lib/auth/session';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  DomainError,
  AuthorizationError,
} from '@/lib/errors';
import { logger } from '@/lib/logging/logger';
import { z } from 'zod';
import type { ZoneStatus } from '@/types/database.types';

export const createZoneSchema = z.object({
  name: z.string().min(1, 'Zone name is required').max(50, 'Zone name is too long'),
  description: z.string().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateZoneSchema = createZoneSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

export class ZoneService {
  /**
   * Resolve authorized restaurant ID for zone operations.
   */
  private static async getAuthorizedContext(targetRestaurantId?: string, targetUserId?: string) {
    let userId: string;
    if (targetUserId) {
      userId = targetUserId;
    } else {
      const user = await requireAuth();
      userId = user.id;
    }
    const adminClient = createAdminClient();

    const { data: membership } = await adminClient
      .from('restaurant_memberships')
      .select('restaurant_id, role, status')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (!membership) {
      throw new AuthorizationError('Active restaurant membership required');
    }

    if (membership.role === 'SUPER_ADMIN') {
      const resolvedId = targetRestaurantId || membership.restaurant_id;
      if (!resolvedId) {
        throw new ValidationError('Target restaurant ID required for platform administration');
      }
      return { userId, restaurantId: resolvedId, role: 'SUPER_ADMIN' as const };
    }

    if (targetRestaurantId && targetRestaurantId !== membership.restaurant_id) {
      throw new AuthorizationError('Tenant mismatch: cannot access another restaurant zone');
    }

    if (!membership.restaurant_id) {
      throw new AuthorizationError('No active restaurant tenant assigned');
    }

    return {
      userId,
      restaurantId: membership.restaurant_id,
      role: membership.role as 'RESTAURANT_ADMIN' | 'STAFF',
    };
  }

  /**
   * List zones for authorized restaurant along with active table counts.
   */
  static async listZones(params: { restaurantId?: string; status?: ZoneStatus; userId?: string } = {}) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_VIEW,
    });

    const supabase = createAdminClient();

    let query = supabase
      .from('restaurant_zones')
      .select('*, restaurant_tables(id, is_archived)', { count: 'exact' })
      .eq('restaurant_id', context.restaurantId);

    if (params.status) {
      query = query.eq('status', params.status);
    }

    const { data, count, error } = await query.order('sort_order', { ascending: true }).order('name', { ascending: true });

    if (error) {
      logger.error('Failed to list restaurant zones', {
        operation: 'listZones',
        restaurantId: context.restaurantId,
        error: error.message,
      });
      throw new DomainError('Failed to retrieve restaurant zones');
    }

    const zones = (data || []).map((z: { id: string; restaurant_id: string; name: string; description: string | null; sort_order: number; status: string; created_at: string; updated_at: string; restaurant_tables?: { id: string; is_archived: boolean }[] }) => {
      const activeTables = (z.restaurant_tables || []).filter(
        (t: { is_archived?: boolean }) => !t.is_archived
      );

      return {
        id: z.id,
        restaurantId: z.restaurant_id,
        name: z.name,
        description: z.description,
        sortOrder: z.sort_order,
        status: z.status as ZoneStatus,
        tableCount: activeTables.length,
        createdAt: z.created_at,
        updatedAt: z.updated_at,
      };
    });

    return { zones, total: count || 0 };
  }

  /**
   * Create a new zone.
   */
  static async createZone(input: CreateZoneInput & { restaurantId?: string; userId?: string }) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_CREATE,
    });

    const parseResult = createZoneSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid zone details', {
        errors: parseResult.error.format(),
      });
    }

    const { name, description, sortOrder } = parseResult.data;
    const adminClient = createAdminClient();

    // Check for duplicate zone name within tenant
    const { data: existing } = await adminClient
      .from('restaurant_zones')
      .select('id')
      .eq('restaurant_id', context.restaurantId)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      throw new ConflictError(`Zone with name '${name.trim()}' already exists in this restaurant`);
    }

    const { data: zone, error } = await adminClient
      .from('restaurant_zones')
      .insert({
        restaurant_id: context.restaurantId,
        name: name.trim(),
        description: description?.trim() || null,
        sort_order: sortOrder,
        status: 'ACTIVE',
      })
      .select()
      .single();

    if (error || !zone) {
      throw new DomainError('Failed to create zone');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'zone_created',
      entity_type: 'restaurant_zone',
      entity_id: zone.id,
      metadata: { name: zone.name, sortOrder: zone.sort_order },
    });

    return zone;
  }

  /**
   * Update an existing zone's details or lifecycle status.
   */
  static async updateZone(
    zoneId: string,
    input: UpdateZoneInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_UPDATE,
    });

    const adminClient = createAdminClient();

    const { data: existing } = await adminClient
      .from('restaurant_zones')
      .select('*')
      .eq('id', zoneId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Zone not found for this restaurant');
    }

    const parseResult = updateZoneSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid zone update input', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined && data.name.trim() !== existing.name) {
      const trimmedName = data.name.trim();
      const { data: nameConflict } = await adminClient
        .from('restaurant_zones')
        .select('id')
        .eq('restaurant_id', context.restaurantId)
        .ilike('name', trimmedName)
        .neq('id', zoneId)
        .maybeSingle();

      if (nameConflict) {
        throw new ConflictError(`Another zone named '${trimmedName}' already exists`);
      }
      updatePayload.name = trimmedName;
    }

    if (data.description !== undefined) {
      updatePayload.description = data.description.trim() || null;
    }

    if (data.sortOrder !== undefined) {
      updatePayload.sort_order = data.sortOrder;
    }

    if (data.status !== undefined && data.status !== existing.status) {
      updatePayload.status = data.status;
    }

    const { data: updated, error } = await adminClient
      .from('restaurant_zones')
      .update(updatePayload)
      .eq('id', zoneId)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError('Failed to update zone');
    }

    const auditAction =
      data.status && data.status !== existing.status
        ? data.status === 'ACTIVE'
          ? 'zone_activated'
          : 'zone_deactivated'
        : 'zone_updated';

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: auditAction,
      entity_type: 'restaurant_zone',
      entity_id: zoneId,
      metadata: updatePayload,
    });

    return updated;
  }
}

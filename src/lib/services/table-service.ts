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
import type { TableStatus, TableShape } from '@/types/database.types';

export const VALID_TABLE_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  AVAILABLE: ['OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'],
  OCCUPIED: ['CLEANING', 'AVAILABLE', 'OUT_OF_SERVICE'],
  CLEANING: ['AVAILABLE', 'OUT_OF_SERVICE'],
  RESERVED: ['OCCUPIED', 'AVAILABLE', 'OUT_OF_SERVICE'],
  OUT_OF_SERVICE: ['AVAILABLE'],
};

export const createTableSchema = z.object({
  tableNumber: z.string().min(1, 'Table number/name is required').max(30, 'Table number is too long'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1').max(50, 'Capacity cannot exceed 50'),
  shape: z.enum(['ROUND', 'SQUARE', 'RECTANGLE', 'BAR']).optional().default('RECTANGLE'),
  zoneId: z.string().uuid('Invalid zone ID').optional().or(z.literal('')),
});

export const bulkCreateTableSchema = z.object({
  zoneId: z.string().uuid('Invalid zone ID'),
  prefix: z.string().max(20).optional().default(''),
  startNumber: z.number().int().min(1, 'Starting number must be at least 1'),
  count: z.number().int().min(1, 'Count must be at least 1').max(100, 'Bulk batch limit is 100 tables'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1').max(50, 'Capacity cannot exceed 50'),
  shape: z.enum(['ROUND', 'SQUARE', 'RECTANGLE', 'BAR']).optional().default('RECTANGLE'),
});

export const updateTableSchema = createTableSchema.partial();

export type CreateTableInput = z.input<typeof createTableSchema>;
export type BulkCreateTableInput = z.input<typeof bulkCreateTableSchema>;
export type UpdateTableInput = z.input<typeof updateTableSchema>;

export class TableService {
  /**
   * Resolve authorized restaurant ID for table operations.
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
      throw new AuthorizationError('Tenant mismatch: cannot access another restaurant table');
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
   * Zeroed tables result with the exact shape of listTables().
   * Degrade-gracefully fallback so a transient tables fetch failure never
   * 500s a page — the UI renders empty tables sections instead.
   */
  static emptyTablesResult() {
    return {
      tables: [] as never[],
      stats: {
        total: 0,
        available: 0,
        occupied: 0,
        cleaning: 0,
        reserved: 0,
        outOfService: 0,
      },
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 0,
    };
  }

  /**
   * Fetch tables for authorized restaurant along with status summary counts.
   */
  static async listTables(params: {
    restaurantId?: string;
    search?: string;
    zoneId?: string;
    status?: TableStatus;
    includeArchived?: boolean;
    page?: number;
    limit?: number;
    userId?: string;
  } = {}) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_VIEW,
    });

    const supabase = createAdminClient();

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('restaurant_tables')
      .select('*, restaurant_zones(id, name, status)', { count: 'exact' })
      .eq('restaurant_id', context.restaurantId);

    if (!params.includeArchived) {
      query = query.eq('is_archived', false);
    }

    if (params.zoneId) {
      query = query.eq('zone_id', params.zoneId);
    }

    if (params.status) {
      query = query.eq('status', params.status);
    }

    if (params.search && params.search.trim() !== '') {
      const term = `%${params.search.trim()}%`;
      query = query.ilike('table_number', term);
    }

    const { data, count, error } = await query
      .order('table_number', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to list restaurant tables', {
        operation: 'listTables',
        restaurantId: context.restaurantId,
        error: error.message,
      });
      throw new DomainError('Failed to retrieve tables');
    }

    // Aggregate Summary Counts across non-archived tables
    const { data: allTables } = await supabase
      .from('restaurant_tables')
      .select('status')
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false);

    const activeList = (allTables || []) as { status: TableStatus }[];
    const stats = {
      total: activeList.length,
      available: activeList.filter((t: { status: TableStatus }) => t.status === 'AVAILABLE').length,
      occupied: activeList.filter((t: { status: TableStatus }) => t.status === 'OCCUPIED').length,
      cleaning: activeList.filter((t: { status: TableStatus }) => t.status === 'CLEANING').length,
      reserved: activeList.filter((t: { status: TableStatus }) => t.status === 'RESERVED').length,
      outOfService: activeList.filter((t: { status: TableStatus }) => t.status === 'OUT_OF_SERVICE').length,
    };

    const tables = (data || []).map((t) => {
      const zone = t.restaurant_zones as unknown as { id: string; name: string; status: string } | null;
      return {
        id: t.id,
        restaurantId: t.restaurant_id,
        zoneId: t.zone_id,
        zoneName: zone?.name || 'Unassigned',
        zoneStatus: zone?.status || 'ACTIVE',
        tableNumber: t.table_number,
        capacity: t.capacity,
        status: t.status as TableStatus,
        shape: (t.shape || 'RECTANGLE') as TableShape,
        occupiedSeats: t.occupied_seats ?? (t.status === 'OCCUPIED' ? t.capacity : 0),
        freeSeats: t.free_seats ?? (t.status === 'OCCUPIED' ? 0 : t.capacity),
        isArchived: t.is_archived,
        archivedAt: t.archived_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      };
    });

    return {
      tables,
      stats,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  /**
   * Create a single table.
   */
  static async createTable(input: CreateTableInput & { restaurantId?: string; userId?: string }) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_CREATE,
    });

    const parseResult = createTableSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid table details', {
        errors: parseResult.error.format(),
      });
    }

    const { tableNumber, capacity, shape, zoneId } = parseResult.data;
    const adminClient = createAdminClient();
    const normalizedNumber = tableNumber.trim();

    // Verify Zone if provided (Must belong to tenant and be ACTIVE)
    if (zoneId) {
      const { data: zone } = await adminClient
        .from('restaurant_zones')
        .select('id, status')
        .eq('id', zoneId)
        .eq('restaurant_id', context.restaurantId)
        .maybeSingle();

      if (!zone) {
        throw new NotFoundError('Zone not found for this restaurant');
      }
      if (zone.status !== 'ACTIVE') {
        throw new ValidationError('Cannot assign table to an inactive zone');
      }
    }

    // Check Duplicate Table Number within Tenant
    const { data: existing } = await adminClient
      .from('restaurant_tables')
      .select('id')
      .eq('restaurant_id', context.restaurantId)
      .eq('table_number', normalizedNumber)
      .eq('is_archived', false)
      .maybeSingle();

    if (existing) {
      throw new ConflictError(`Table '${normalizedNumber}' already exists in this restaurant`);
    }

    const { data: table, error } = await adminClient
      .from('restaurant_tables')
      .insert({
        restaurant_id: context.restaurantId,
        zone_id: zoneId || null,
        table_number: normalizedNumber,
        capacity,
        shape: shape || 'RECTANGLE',
        occupied_seats: 0,
        free_seats: capacity,
        status: 'AVAILABLE',
      })
      .select()
      .single();

    if (error || !table) {
      throw new DomainError(`Failed to create table: ${error?.message || 'Unknown error'}`);
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'table_created',
      entity_type: 'restaurant_table',
      entity_id: table.id,
      metadata: { tableNumber: normalizedNumber, capacity, zoneId },
    });

    return table;
  }

  /**
   * Transactional Bulk Table Setup (Bounded max 100 tables per batch).
   */
  static async bulkCreateTables(input: BulkCreateTableInput & { restaurantId?: string; userId?: string }) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_CREATE,
    });

    const parseResult = bulkCreateTableSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid bulk table setup input', {
        errors: parseResult.error.format(),
      });
    }

    const { zoneId, prefix, startNumber, count, capacity, shape } = parseResult.data;
    const adminClient = createAdminClient();

    // Verify Zone
    const { data: zone } = await adminClient
      .from('restaurant_zones')
      .select('id, status')
      .eq('id', zoneId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!zone) {
      throw new NotFoundError('Zone not found for this restaurant');
    }
    if (zone.status !== 'ACTIVE') {
      throw new ValidationError('Cannot assign tables to an inactive zone');
    }

    // Build batch payload
    const prefixStr = prefix ? prefix.trim() : '';
    const tableBatch: {
      restaurant_id: string;
      zone_id: string;
      table_number: string;
      capacity: number;
      shape: string;
      occupied_seats: number;
      free_seats: number;
      status: string;
    }[] = [];
    const generatedNumbers: string[] = [];

    for (let i = 0; i < count; i++) {
      const numStr = `${prefixStr}${startNumber + i}`;
      generatedNumbers.push(numStr);
      tableBatch.push({
        restaurant_id: context.restaurantId,
        zone_id: zoneId,
        table_number: numStr,
        capacity,
        shape: shape || 'RECTANGLE',
        occupied_seats: 0,
        free_seats: capacity,
        status: 'AVAILABLE',
      });
    }

    // Check duplicate table numbers within tenant
    const { data: existingDuplicates } = await adminClient
      .from('restaurant_tables')
      .select('table_number')
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .in('table_number', generatedNumbers);

    if (existingDuplicates && existingDuplicates.length > 0) {
      const dups = existingDuplicates.map((d: { table_number: string }) => d.table_number).join(', ');
      throw new ConflictError(`Bulk setup conflict: Tables already exist: ${dups}`);
    }

    // Atomic Insert
    const { data: createdTables, error } = await adminClient
      .from('restaurant_tables')
      .insert(tableBatch)
      .select();

    if (error || !createdTables) {
      throw new DomainError(`Failed bulk table creation: ${error?.message || 'Unknown database error'}`);
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'bulk_tables_created',
      entity_type: 'restaurant_tables',
      entity_id: context.restaurantId,
      metadata: { zoneId, count: createdTables.length, numbers: generatedNumbers, capacity, shape },
    });

    return { createdCount: createdTables.length, tables: createdTables };
  }

  /**
   * Update table metadata (number, capacity, zone).
   */
  static async updateTable(
    tableId: string,
    input: UpdateTableInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_UPDATE,
    });

    const adminClient = createAdminClient();

    const { data: existing } = await adminClient
      .from('restaurant_tables')
      .select('*')
      .eq('id', tableId)
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Table not found or archived');
    }

    const parseResult = updateTableSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid table update details', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.shape !== undefined) {
      updatePayload.shape = data.shape;
    }

    if (data.tableNumber !== undefined && data.tableNumber.trim() !== existing.table_number) {
      const normNumber = data.tableNumber.trim();
      const { data: duplicate } = await adminClient
        .from('restaurant_tables')
        .select('id')
        .eq('restaurant_id', context.restaurantId)
        .eq('table_number', normNumber)
        .eq('is_archived', false)
        .neq('id', tableId)
        .maybeSingle();

      if (duplicate) {
        throw new ConflictError(`Table number '${normNumber}' is already in use`);
      }
      updatePayload.table_number = normNumber;
    }

    if (data.capacity !== undefined) {
      updatePayload.capacity = data.capacity;
      // Also recalibrate free_seats if table is AVAILABLE
      if (existing.status === 'AVAILABLE') {
        updatePayload.free_seats = data.capacity;
        updatePayload.occupied_seats = 0;
      }
    }

    if (data.zoneId !== undefined) {
      const newZoneId = data.zoneId || null;
      if (newZoneId) {
        const { data: zone } = await adminClient
          .from('restaurant_zones')
          .select('id, status')
          .eq('id', newZoneId)
          .eq('restaurant_id', context.restaurantId)
          .maybeSingle();

        if (!zone) {
          throw new NotFoundError('Zone not found for this restaurant');
        }
        if (zone.status !== 'ACTIVE') {
          throw new ValidationError('Cannot assign table to an inactive zone');
        }
      }
      updatePayload.zone_id = newZoneId;
    }

    const { data: updated, error } = await adminClient
      .from('restaurant_tables')
      .update(updatePayload)
      .eq('id', tableId)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError('Failed to update table details');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'table_updated',
      entity_type: 'restaurant_table',
      entity_id: tableId,
      metadata: updatePayload,
    });

    return updated;
  }

  /**
   * Archive a table (preserves historical references). Physical deletion is prohibited.
   */
  static async archiveTable(tableId: string, targetRestaurantId?: string, userId?: string) {
    const context = await this.getAuthorizedContext(targetRestaurantId, userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_DELETE,
    });

    const adminClient = createAdminClient();

    const { data: existing } = await adminClient
      .from('restaurant_tables')
      .select('id, table_number, is_archived')
      .eq('id', tableId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Table not found');
    }

    if (existing.is_archived) {
      throw new DomainError('Table is already archived');
    }

    const { data: archived, error } = await adminClient
      .from('restaurant_tables')
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tableId)
      .select()
      .single();

    if (error || !archived) {
      throw new DomainError('Failed to archive table');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'table_archived',
      entity_type: 'restaurant_table',
      entity_id: tableId,
      metadata: { tableNumber: existing.table_number },
    });

    return archived;
  }

  /**
   * Atomic Concurrency-Safe Table Status Transition (Enforces FSM & Prevents Race Conditions).
   */
  static async updateTableStatus(
    tableId: string,
    targetStatus: TableStatus,
    currentStatus?: TableStatus,
    targetRestaurantId?: string,
    userId?: string
  ) {
    const context = await this.getAuthorizedContext(targetRestaurantId, userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.TABLES_MANAGE_STATUS,
    });

    const adminClient = createAdminClient();

    // Fetch existing table to validate state transition rules
    const { data: existing } = await adminClient
      .from('restaurant_tables')
      .select('id, status, capacity, is_archived')
      .eq('id', tableId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Table not found for this restaurant');
    }

    if (existing.is_archived) {
      throw new DomainError('Archived tables cannot change status');
    }

    const actualCurrentStatus = existing.status as TableStatus;

    if (currentStatus && currentStatus !== actualCurrentStatus) {
      throw new ConflictError(
        `Table status conflict: expected '${currentStatus}' but table is currently '${actualCurrentStatus}'`
      );
    }

    if (actualCurrentStatus === targetStatus) {
      return existing;
    }

    // Validate State Machine Rules
    const allowedTargets = VALID_TABLE_TRANSITIONS[actualCurrentStatus] || [];
    if (!allowedTargets.includes(targetStatus)) {
      throw new DomainError(
        `Invalid table status transition from '${actualCurrentStatus}' to '${targetStatus}'`
      );
    }

    // Atomic Conditional Update: WHERE status = actualCurrentStatus (guarantees race condition safety)
    const expectedCurrentStatus = currentStatus || actualCurrentStatus;

    const { data: updated, error } = await adminClient
      .from('restaurant_tables')
      .update({
        status: targetStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tableId)
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .eq('status', expectedCurrentStatus)
      .select()
      .single();

    if (error || !updated) {
      throw new ConflictError(
        'Table status was modified concurrently by another request. Please refresh.'
      );
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'table_status_changed',
      entity_type: 'restaurant_table',
      entity_id: tableId,
      metadata: { previousStatus: actualCurrentStatus, targetStatus },
    });

    // When table becomes AVAILABLE or moves to CLEANING after dining, seated guest exits the flow
    if (actualCurrentStatus === 'OCCUPIED' && (targetStatus === 'AVAILABLE' || targetStatus === 'CLEANING')) {
      try {
        const nowIso = new Date().toISOString();

        // 1. Reset table occupied and free seats if transitioning to AVAILABLE or CLEANING
        await adminClient
          .from('restaurant_tables')
          .update({
            occupied_seats: 0,
            free_seats: existing.capacity,
            updated_at: nowIso,
          })
          .eq('id', tableId);

        // 2. Remove any active seating assignments for this table
        await adminClient
          .from('active_seating_assignments')
          .delete()
          .eq('table_id', tableId);

        // 3. Complete associated seated guests
        const { data: seatedGuests } = await adminClient
          .from('queue_entries')
          .select('id')
          .eq('restaurant_id', context.restaurantId)
          .eq('seated_table_id', tableId)
          .eq('status', 'SEATED')
          .is('completed_at', null);

        if (seatedGuests && seatedGuests.length > 0) {
          for (const sg of seatedGuests) {
            await adminClient
              .from('queue_entries')
              .update({ completed_at: nowIso, updated_at: nowIso })
              .eq('id', sg.id);

            await adminClient.from('queue_events').insert({
              restaurant_id: context.restaurantId,
              queue_entry_id: sg.id,
              event_type: 'QUEUE_COMPLETED',
              actor_user_id: context.userId,
              metadata: {
                table_id: tableId,
                target_status: targetStatus,
                reason: `TABLE_STATE_TRANSITION_TO_${targetStatus}`,
              },
            });
          }
        }
      } catch {
        // Non-blocking
      }
    }

    return updated;
  }
}

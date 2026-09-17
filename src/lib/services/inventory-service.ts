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
import type { InventoryUnit, MovementType, StockState } from '@/types/database.types';
import { Client } from 'pg';

export const VALID_INVENTORY_UNITS: InventoryUnit[] = [
  'kg',
  'g',
  'liter',
  'ml',
  'piece',
  'packet',
  'box',
  'bottle',
];

export const VALID_MOVEMENT_TYPES: MovementType[] = [
  'INITIAL',
  'PURCHASE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'WASTE',
  'CORRECTION',
];

export const createInventoryItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(100, 'Item name is too long'),
  sku: z.string().max(50).optional().or(z.literal('')),
  unit: z.enum(['kg', 'g', 'liter', 'ml', 'piece', 'packet', 'box', 'bottle'] as const, {
    message: 'Invalid inventory unit',
  }),
  openingQuantity: z.number().min(0, 'Opening quantity must be at least 0').optional().default(0),
  lowStockThreshold: z.number().min(0, 'Low stock threshold must be at least 0').optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateInventoryItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(100).optional(),
  sku: z.string().max(50).optional().or(z.literal('')),
  unit: z.enum(['kg', 'g', 'liter', 'ml', 'piece', 'packet', 'box', 'bottle'] as const).optional(),
  lowStockThreshold: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const adjustStockSchema = z.object({
  inventoryItemId: z.string().uuid('Invalid inventory item ID'),
  movementType: z.enum([
    'INITIAL',
    'PURCHASE',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'WASTE',
    'CORRECTION',
  ] as const),
  quantity: z.number().positive('Quantity must be greater than 0'),
  reason: z.string().min(1, 'Reason for adjustment is required').max(250, 'Reason is too long'),
});

export type CreateInventoryItemInput = z.input<typeof createInventoryItemSchema>;
export type UpdateInventoryItemInput = z.input<typeof updateInventoryItemSchema>;
export type AdjustStockInput = z.input<typeof adjustStockSchema>;

export class InventoryService {
  /**
   * Resolve authorized restaurant ID for inventory operations.
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
      throw new AuthorizationError('Tenant mismatch: cannot access another restaurant inventory');
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
   * Helper to execute a database transaction via pg client when DATABASE_URL is available.
   */
  private static async executePgTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new DomainError('DATABASE_URL connection string unavailable for transaction execution');
    }
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      await client.end();
    }
  }

  // --------------------------------------------------------------------------
  // INVENTORY ITEMS CRUD
  // --------------------------------------------------------------------------

  static async listInventoryItems(params: {
    restaurantId?: string;
    search?: string;
    stockState?: StockState;
    activeOnly?: boolean;
    includeArchived?: boolean;
    page?: number;
    limit?: number;
    userId?: string;
  } = {}) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.INVENTORY_VIEW,
    });

    const adminClient = createAdminClient();
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;

    let query = adminClient
      .from('inventory_items')
      .select('*', { count: 'exact' })
      .eq('restaurant_id', context.restaurantId);

    if (!params.includeArchived) {
      query = query.eq('is_archived', false);
    }

    if (params.activeOnly) {
      query = query.eq('is_active', true);
    }

    if (params.search && params.search.trim() !== '') {
      const term = `%${params.search.trim()}%`;
      query = query.or(`name.ilike.${term},sku.ilike.${term}`);
    }

    const { data, count, error } = await query
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to list inventory items', {
        operation: 'listInventoryItems',
        restaurantId: context.restaurantId,
        error: error.message,
      });
      throw new DomainError('Failed to retrieve inventory items');
    }

    // Summary Metric Aggregation across non-archived inventory
    const { data: allActive } = await adminClient
      .from('inventory_items')
      .select('current_quantity, low_stock_threshold, is_active')
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false);

    const activeList = (allActive || []) as { current_quantity: number; low_stock_threshold: number; is_active: boolean }[];
    const stats = {
      total: activeList.length,
      activeCount: activeList.filter((i) => i.is_active).length,
      outOfStock: activeList.filter((i) => Number(i.current_quantity) <= 0).length,
      lowStock: activeList.filter((i) => Number(i.current_quantity) > 0 && Number(i.current_quantity) <= Number(i.low_stock_threshold)).length,
    };

    const mappedItems = (data || []).map((i) => {
      const qty = Number(i.current_quantity);
      const threshold = Number(i.low_stock_threshold);
      const stockState: StockState =
        qty <= 0 ? 'OUT_OF_STOCK' : qty <= threshold ? 'LOW_STOCK' : 'NORMAL';

      return {
        id: i.id,
        restaurantId: i.restaurant_id,
        name: i.name,
        sku: i.sku,
        unit: i.unit as InventoryUnit,
        currentQuantity: qty,
        lowStockThreshold: threshold,
        isActive: i.is_active,
        isArchived: i.is_archived,
        stockState,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      };
    });

    // Optional Stock State Filter
    const filteredItems = params.stockState
      ? mappedItems.filter((i) => i.stockState === params.stockState)
      : mappedItems;

    return {
      items: filteredItems,
      stats,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  /**
   * Transactional Creation of Inventory Item + INITIAL Movement Ledger Record.
   */
  static async createInventoryItem(
    input: CreateInventoryItemInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.INVENTORY_CREATE,
    });

    const parseResult = createInventoryItemSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid inventory item details', {
        errors: parseResult.error.format(),
      });
    }

    const { name, sku, unit, openingQuantity, lowStockThreshold, isActive } = parseResult.data;
    const trimmedName = name.trim();
    const trimmedSku = sku?.trim() || null;

    // Execute atomic creation via pg transaction when DATABASE_URL is available
    if (process.env.DATABASE_URL) {
      return await this.executePgTransaction(async (pgClient) => {
        // Check duplicate name within tenant
        const dupRes = await pgClient.query(
          `SELECT id FROM public.inventory_items WHERE restaurant_id = $1::uuid AND is_archived = false AND LOWER(name) = LOWER($2)`,
          [context.restaurantId, trimmedName]
        );
        if (dupRes.rows.length > 0) {
          throw new ConflictError(`Inventory item '${trimmedName}' already exists in this restaurant`);
        }

        // Insert Item
        const itemRes = await pgClient.query(
          `INSERT INTO public.inventory_items (restaurant_id, name, sku, unit, current_quantity, low_stock_threshold, is_active)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            context.restaurantId,
            trimmedName,
            trimmedSku,
            unit,
            openingQuantity,
            lowStockThreshold,
            isActive,
          ]
        );
        const item = itemRes.rows[0];

        // Insert INITIAL Movement Ledger Entry
        await pgClient.query(
          `INSERT INTO public.inventory_movements (restaurant_id, inventory_item_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_by)
           VALUES ($1::uuid, $2::uuid, 'INITIAL', $3, 0.000, $4, 'Opening stock initial setup', $5::uuid)`,
          [context.restaurantId, item.id, openingQuantity, openingQuantity, context.userId]
        );

        // Insert Audit Log
        await pgClient.query(
          `INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1::uuid, $2::uuid, 'inventory_item_created', 'inventory_item', $3::uuid, $4::jsonb)`,
          [
            context.restaurantId,
            context.userId,
            item.id,
            JSON.stringify({ name: item.name, openingQuantity, unit }),
          ]
        );

        return item;
      });
    }

    // Fallback: Admin client sequential
    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('inventory_items')
      .select('id')
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .ilike('name', trimmedName)
      .maybeSingle();

    if (existing) {
      throw new ConflictError(`Inventory item '${trimmedName}' already exists in this restaurant`);
    }

    const { data: item, error } = await adminClient
      .from('inventory_items')
      .insert({
        restaurant_id: context.restaurantId,
        name: trimmedName,
        sku: trimmedSku,
        unit,
        current_quantity: openingQuantity,
        low_stock_threshold: lowStockThreshold,
        is_active: isActive,
      })
      .select()
      .single();

    if (error || !item) {
      throw new DomainError(`Failed to create inventory item: ${error?.message || 'Unknown database error'}`);
    }

    await adminClient.from('inventory_movements').insert({
      restaurant_id: context.restaurantId,
      inventory_item_id: item.id,
      movement_type: 'INITIAL',
      quantity_delta: openingQuantity,
      quantity_before: 0,
      quantity_after: openingQuantity,
      reason: 'Opening stock initial setup',
      created_by: context.userId,
    });

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'inventory_item_created',
      entity_type: 'inventory_item',
      entity_id: item.id,
      metadata: { name: item.name, openingQuantity, unit },
    });

    return item;
  }

  static async updateInventoryItem(
    itemId: string,
    input: UpdateInventoryItemInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.INVENTORY_UPDATE,
    });

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Inventory item not found or archived');
    }

    const parseResult = updateInventoryItemSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid inventory update details', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined && data.name.trim() !== existing.name) {
      const normName = data.name.trim();
      const { data: duplicate } = await adminClient
        .from('inventory_items')
        .select('id')
        .eq('restaurant_id', context.restaurantId)
        .eq('is_archived', false)
        .ilike('name', normName)
        .neq('id', itemId)
        .maybeSingle();

      if (duplicate) {
        throw new ConflictError(`Inventory item name '${normName}' is already in use`);
      }
      updatePayload.name = normName;
    }

    if (data.sku !== undefined) {
      updatePayload.sku = data.sku.trim() || null;
    }

    if (data.unit !== undefined) {
      updatePayload.unit = data.unit;
    }

    if (data.lowStockThreshold !== undefined) {
      updatePayload.low_stock_threshold = data.lowStockThreshold;
    }

    if (data.isActive !== undefined) {
      updatePayload.is_active = data.isActive;
    }

    const { data: updated, error } = await adminClient
      .from('inventory_items')
      .update(updatePayload)
      .eq('id', itemId)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError('Failed to update inventory item');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'inventory_item_updated',
      entity_type: 'inventory_item',
      entity_id: itemId,
      metadata: updatePayload,
    });

    return updated;
  }

  static async archiveInventoryItem(itemId: string, targetRestaurantId?: string, userId?: string) {
    const context = await this.getAuthorizedContext(targetRestaurantId, userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.INVENTORY_UPDATE,
    });

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('inventory_items')
      .select('id, name, is_archived')
      .eq('id', itemId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Inventory item not found');
    }

    if (existing.is_archived) {
      throw new DomainError('Inventory item is already archived');
    }

    const { data: archived, error } = await adminClient
      .from('inventory_items')
      .update({
        is_active: false,
        is_archived: true,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .select()
      .single();

    if (error || !archived) {
      throw new DomainError('Failed to archive inventory item');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'inventory_item_archived',
      entity_type: 'inventory_item',
      entity_id: itemId,
      metadata: { name: existing.name },
    });

    return archived;
  }

  // --------------------------------------------------------------------------
  // ATOMIC CONCURRENCY-SAFE STOCK ADJUSTMENT
  // --------------------------------------------------------------------------

  static async adjustStock(
    input: AdjustStockInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.INVENTORY_ADJUST,
    });

    const parseResult = adjustStockSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid stock adjustment input', {
        errors: parseResult.error.format(),
      });
    }

    const { inventoryItemId, movementType, quantity, reason } = parseResult.data;

    // Calculate signed quantity delta
    const isOutward = ['ADJUSTMENT_OUT', 'WASTE'].includes(movementType);
    const quantityDelta = isOutward ? -Math.abs(quantity) : Math.abs(quantity);

    // Execute via atomic Postgres transaction with SELECT FOR UPDATE when DATABASE_URL is available
    if (process.env.DATABASE_URL) {
      return await this.executePgTransaction(async (pgClient) => {
        // Lock inventory row exclusively
        const itemRes = await pgClient.query(
          `SELECT id, name, current_quantity, is_active, is_archived
           FROM public.inventory_items
           WHERE id = $1::uuid AND restaurant_id = $2::uuid
           FOR UPDATE`,
          [inventoryItemId, context.restaurantId]
        );

        if (itemRes.rows.length === 0) {
          throw new NotFoundError('Inventory item not found for this restaurant');
        }

        const item = itemRes.rows[0];
        if (item.is_archived) {
          throw new DomainError('Archived inventory items cannot receive stock adjustments');
        }

        const quantityBefore = Number(item.current_quantity);
        const quantityAfter = Number((quantityBefore + quantityDelta).toFixed(3));

        if (quantityAfter < 0) {
          throw new ValidationError(
            `Insufficient stock: current stock is ${quantityBefore}, adjustment of ${quantityDelta} would result in negative stock (${quantityAfter})`
          );
        }

        // 1. Insert Append-Only Ledger Entry
        const movementRes = await pgClient.query(
          `INSERT INTO public.inventory_movements
            (restaurant_id, inventory_item_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_by)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)
           RETURNING *`,
          [
            context.restaurantId,
            inventoryItemId,
            movementType,
            quantityDelta,
            quantityBefore,
            quantityAfter,
            reason.trim(),
            context.userId,
          ]
        );
        const movement = movementRes.rows[0];

        // 2. Update Item Current Quantity
        await pgClient.query(
          `UPDATE public.inventory_items
           SET current_quantity = $1, updated_at = NOW()
           WHERE id = $2::uuid AND restaurant_id = $3::uuid`,
          [quantityAfter, inventoryItemId, context.restaurantId]
        );

        // 3. Write Structured Audit Log
        await pgClient.query(
          `INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1::uuid, $2::uuid, 'inventory_adjustment_created', 'inventory_movement', $3::uuid, $4::jsonb)`,
          [
            context.restaurantId,
            context.userId,
            movement.id,
            JSON.stringify({
              inventoryItemId,
              itemName: item.name,
              movementType,
              quantityDelta,
              quantityBefore,
              quantityAfter,
              reason,
            }),
          ]
        );

        return {
          movement,
          quantityBefore,
          quantityAfter,
          newItemQuantity: quantityAfter,
        };
      });
    }

    // Fallback: PostgREST conditional atomic update with optimistic concurrency retry loop
    const adminClient = createAdminClient();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: item } = await adminClient
        .from('inventory_items')
        .select('id, name, current_quantity, is_archived')
        .eq('id', inventoryItemId)
        .eq('restaurant_id', context.restaurantId)
        .maybeSingle();

      if (!item) {
        throw new NotFoundError('Inventory item not found for this restaurant');
      }

      if (item.is_archived) {
        throw new DomainError('Archived inventory items cannot receive stock adjustments');
      }

      const quantityBefore = Number(item.current_quantity);
      const quantityAfter = Number((quantityBefore + quantityDelta).toFixed(3));

      if (quantityAfter < 0) {
        throw new ValidationError(
          `Insufficient stock: current stock is ${quantityBefore}, adjustment of ${quantityDelta} would result in negative stock (${quantityAfter})`
        );
      }

      // Try conditional update WHERE current_quantity = quantityBefore
      const { data: updatedItem, error: updateErr } = await adminClient
        .from('inventory_items')
        .update({
          current_quantity: quantityAfter,
          updated_at: new Date().toISOString(),
        })
        .eq('id', inventoryItemId)
        .eq('restaurant_id', context.restaurantId)
        .eq('current_quantity', quantityBefore)
        .select()
        .single();

      if (!updateErr && updatedItem) {
        const { data: movement } = await adminClient
          .from('inventory_movements')
          .insert({
            restaurant_id: context.restaurantId,
            inventory_item_id: inventoryItemId,
            movement_type: movementType,
            quantity_delta: quantityDelta,
            quantity_before: quantityBefore,
            quantity_after: quantityAfter,
            reason: reason.trim(),
            created_by: context.userId,
          })
          .select()
          .single();

        await adminClient.from('audit_logs').insert({
          restaurant_id: context.restaurantId,
          actor_user_id: context.userId,
          action: 'inventory_adjustment_created',
          entity_type: 'inventory_movement',
          entity_id: movement?.id || inventoryItemId,
          metadata: { inventoryItemId, movementType, quantityDelta, quantityBefore, quantityAfter, reason },
        });

        return {
          movement,
          quantityBefore,
          quantityAfter,
          newItemQuantity: quantityAfter,
        };
      }
    }

    throw new ConflictError('Stock was updated concurrently by another transaction. Please try again.');
  }

  // --------------------------------------------------------------------------
  // READ-ONLY MOVEMENT HISTORY LEDGER
  // --------------------------------------------------------------------------

  static async getMovementHistory(
    inventoryItemId: string,
    params: { restaurantId?: string; page?: number; limit?: number; userId?: string } = {}
  ) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.INVENTORY_VIEW,
    });

    const adminClient = createAdminClient();

    // Verify item belongs to tenant
    const { data: item } = await adminClient
      .from('inventory_items')
      .select('id, name, unit, current_quantity, low_stock_threshold')
      .eq('id', inventoryItemId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!item) {
      throw new NotFoundError('Inventory item not found');
    }

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;

    const { data, count, error } = await adminClient
      .from('inventory_movements')
      .select('*', { count: 'exact' })
      .eq('inventory_item_id', inventoryItemId)
      .eq('restaurant_id', context.restaurantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to fetch inventory movement history', {
        operation: 'getMovementHistory',
        inventoryItemId,
        error: error.message,
      });
      throw new DomainError('Failed to retrieve movement history');
    }

    // Fetch user profiles for creator names
    const creatorUserIds = Array.from(
      new Set((data || []).map((m) => m.created_by).filter((id): id is string => Boolean(id)))
    );

    let userMap: Record<string, string> = {};
    if (creatorUserIds.length > 0) {
      const { data: users } = await adminClient
        .from('user_profiles')
        .select('id, display_name, email')
        .in('id', creatorUserIds);

      if (users) {
        userMap = Object.fromEntries(
          users.map((u) => [u.id, u.display_name || u.email || u.id])
        );
      }
    }

    const movements = (data || []).map((m) => {
      return {
        id: m.id,
        restaurantId: m.restaurant_id,
        inventoryItemId: m.inventory_item_id,
        movementType: m.movement_type as MovementType,
        quantityDelta: Number(m.quantity_delta),
        quantityBefore: Number(m.quantity_before),
        quantityAfter: Number(m.quantity_after),
        reason: m.reason,
        createdByUserId: m.created_by,
        createdByUserName: (m.created_by && userMap[m.created_by]) || 'System / Staff',
        createdAt: m.created_at,
      };
    });

    return {
      item: {
        id: item.id,
        name: item.name,
        unit: item.unit as InventoryUnit,
        currentQuantity: Number(item.current_quantity),
        lowStockThreshold: Number(item.low_stock_threshold),
      },
      movements,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }
}

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

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(50, 'Category name is too long'),
  description: z.string().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateCategorySchema = createCategorySchema.partial().extend({
  active: z.boolean().optional(),
});

export const createMenuItemSchema = z.object({
  categoryId: z.string().uuid('Invalid category ID').optional().or(z.literal('')),
  name: z.string().min(1, 'Menu item name is required').max(100, 'Name is too long'),
  description: z.string().optional(),
  price: z.number().min(0, 'Price must be greater than or equal to 0').max(100000, 'Price is too high'),
  preparationTimeMinutes: z.number().int().min(0).optional().default(15),
  active: z.boolean().optional().default(true),
  available: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0).optional().default(0),
  imageUrl: z.string().url().optional().or(z.literal('')),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;
export type CreateMenuItemInput = z.input<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.input<typeof updateMenuItemSchema>;

export class MenuService {
  /**
   * Resolve authorized restaurant ID for menu operations.
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
      throw new AuthorizationError('Tenant mismatch: cannot access another restaurant menu');
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

  // --------------------------------------------------------------------------
  // CATEGORIES MANAGEMENT
  // --------------------------------------------------------------------------

  static async listCategories(params: { restaurantId?: string; activeOnly?: boolean; userId?: string } = {}) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_VIEW,
    });

    const adminClient = createAdminClient();
    let query = adminClient
      .from('menu_categories')
      .select('*, menu_items(id, is_archived)', { count: 'exact' })
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false);

    if (params.activeOnly) {
      query = query.eq('active', true);
    }

    const { data, count, error } = await query
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      logger.error('Failed to list menu categories', {
        operation: 'listCategories',
        restaurantId: context.restaurantId,
        error: error.message,
      });
      throw new DomainError('Failed to retrieve menu categories');
    }

    const categories = (data || []).map((c) => {
      const items = c.menu_items || [];
      const activeItemCount = items.filter((i: { is_archived?: boolean }) => !i.is_archived).length;

      return {
        id: c.id,
        restaurantId: c.restaurant_id,
        name: c.name,
        description: c.description,
        sortOrder: c.sort_order,
        active: c.active,
        isArchived: c.is_archived,
        itemCount: activeItemCount,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    });

    return { categories, total: count || 0 };
  }

  static async createCategory(input: CreateCategoryInput & { restaurantId?: string; userId?: string }) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_CREATE,
    });

    const parseResult = createCategorySchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid category details', {
        errors: parseResult.error.format(),
      });
    }

    const { name, description, sortOrder } = parseResult.data;
    const adminClient = createAdminClient();
    const trimmedName = name.trim();

    // Check duplicate category name within tenant
    const { data: existing } = await adminClient
      .from('menu_categories')
      .select('id')
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .ilike('name', trimmedName)
      .maybeSingle();

    if (existing) {
      throw new ConflictError(`Category '${trimmedName}' already exists in this restaurant`);
    }

    const { data: category, error } = await adminClient
      .from('menu_categories')
      .insert({
        restaurant_id: context.restaurantId,
        name: trimmedName,
        description: description?.trim() || null,
        sort_order: sortOrder,
        active: true,
      })
      .select()
      .single();

    if (error || !category) {
      throw new DomainError(`Failed to create category: ${error?.message || 'Unknown database error'}`);
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'menu_category_created',
      entity_type: 'menu_category',
      entity_id: category.id,
      metadata: { name: category.name, sortOrder: category.sort_order },
    });

    return category;
  }

  static async updateCategory(
    categoryId: string,
    input: UpdateCategoryInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_UPDATE,
    });

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('menu_categories')
      .select('*')
      .eq('id', categoryId)
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Menu category not found');
    }

    const parseResult = updateCategorySchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid category update details', {
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
        .from('menu_categories')
        .select('id')
        .eq('restaurant_id', context.restaurantId)
        .eq('is_archived', false)
        .ilike('name', normName)
        .neq('id', categoryId)
        .maybeSingle();

      if (duplicate) {
        throw new ConflictError(`Category name '${normName}' is already in use`);
      }
      updatePayload.name = normName;
    }

    if (data.description !== undefined) {
      updatePayload.description = data.description.trim() || null;
    }

    if (data.sortOrder !== undefined) {
      updatePayload.sort_order = data.sortOrder;
    }

    if (data.active !== undefined && data.active !== existing.active) {
      updatePayload.active = data.active;
    }

    const { data: updated, error } = await adminClient
      .from('menu_categories')
      .update(updatePayload)
      .eq('id', categoryId)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError('Failed to update category');
    }

    const auditAction =
      data.active !== undefined && data.active !== existing.active
        ? data.active
          ? 'menu_category_activated'
          : 'menu_category_deactivated'
        : 'menu_category_updated';

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: auditAction,
      entity_type: 'menu_category',
      entity_id: categoryId,
      metadata: updatePayload,
    });

    return updated;
  }

  // --------------------------------------------------------------------------
  // MENU ITEMS MANAGEMENT
  // --------------------------------------------------------------------------

  static async listMenuItems(params: {
    restaurantId?: string;
    search?: string;
    categoryId?: string;
    activeOnly?: boolean;
    availableOnly?: boolean;
    includeArchived?: boolean;
    page?: number;
    limit?: number;
    userId?: string;
  } = {}) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_VIEW,
    });

    const adminClient = createAdminClient();
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;

    let query = adminClient
      .from('menu_items')
      .select('*, menu_categories(id, name, active)', { count: 'exact' })
      .eq('restaurant_id', context.restaurantId);

    if (!params.includeArchived) {
      query = query.eq('is_archived', false);
    }

    if (params.categoryId) {
      query = query.eq('category_id', params.categoryId);
    }

    if (params.activeOnly) {
      query = query.eq('active', true);
    }

    if (params.availableOnly) {
      query = query.eq('available', true);
    }

    if (params.search && params.search.trim() !== '') {
      const term = `%${params.search.trim()}%`;
      query = query.ilike('name', term);
    }

    const { data, count, error } = await query
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to list menu items', {
        operation: 'listMenuItems',
        restaurantId: context.restaurantId,
        error: error.message,
      });
      throw new DomainError('Failed to retrieve menu items');
    }

    const items = (data || []).map((i) => {
      const cat = i.menu_categories as unknown as { id: string; name: string; active: boolean } | null;
      return {
        id: i.id,
        restaurantId: i.restaurant_id,
        categoryId: i.category_id,
        categoryName: cat?.name || 'Unassigned',
        categoryActive: cat?.active ?? true,
        name: i.name,
        description: i.description,
        price: Number(i.price),
        currency: i.currency,
        preparationTimeMinutes: i.preparation_time_minutes,
        active: i.active,
        available: i.available,
        isArchived: i.is_archived,
        archivedAt: i.archived_at,
        displayOrder: i.display_order,
        imageUrl: i.image_url,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      };
    });

    return {
      items,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  static async createMenuItem(input: CreateMenuItemInput & { restaurantId?: string; userId?: string }) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_CREATE,
    });

    const parseResult = createMenuItemSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid menu item details', {
        errors: parseResult.error.format(),
      });
    }

    const {
      categoryId,
      name,
      description,
      price,
      preparationTimeMinutes,
      active,
      available,
      displayOrder,
      imageUrl,
    } = parseResult.data;

    const adminClient = createAdminClient();
    const normName = name.trim();
    const targetCategory = categoryId || null;

    // Verify Category if provided
    if (targetCategory) {
      const { data: category } = await adminClient
        .from('menu_categories')
        .select('id, active, is_archived')
        .eq('id', targetCategory)
        .eq('restaurant_id', context.restaurantId)
        .maybeSingle();

      if (!category || category.is_archived) {
        throw new NotFoundError('Category not found for this restaurant');
      }

      if (!category.active) {
        throw new ValidationError('Cannot assign new menu items to an inactive category');
      }
    }

    const { data: item, error } = await adminClient
      .from('menu_items')
      .insert({
        restaurant_id: context.restaurantId,
        category_id: targetCategory,
        name: normName,
        description: description?.trim() || null,
        price,
        preparation_time_minutes: preparationTimeMinutes,
        active,
        available,
        display_order: displayOrder,
        image_url: imageUrl?.trim() || null,
      })
      .select()
      .single();

    if (error || !item) {
      throw new DomainError(`Failed to create menu item: ${error?.message || 'Unknown database error'}`);
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'menu_item_created',
      entity_type: 'menu_item',
      entity_id: item.id,
      metadata: { name: item.name, price: item.price, categoryId: targetCategory },
    });

    return item;
  }

  static async updateMenuItem(
    itemId: string,
    input: UpdateMenuItemInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_UPDATE,
    });

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('menu_items')
      .select('*')
      .eq('id', itemId)
      .eq('restaurant_id', context.restaurantId)
      .eq('is_archived', false)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Menu item not found or archived');
    }

    const parseResult = updateMenuItemSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid menu item update details', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) {
      updatePayload.name = data.name.trim();
    }

    if (data.description !== undefined) {
      updatePayload.description = data.description.trim() || null;
    }

    if (data.price !== undefined) {
      updatePayload.price = data.price;
    }

    if (data.preparationTimeMinutes !== undefined) {
      updatePayload.preparation_time_minutes = data.preparationTimeMinutes;
    }

    if (data.active !== undefined && data.active !== existing.active) {
      updatePayload.active = data.active;
    }

    if (data.available !== undefined && data.available !== existing.available) {
      updatePayload.available = data.available;
    }

    if (data.displayOrder !== undefined) {
      updatePayload.display_order = data.displayOrder;
    }

    if (data.imageUrl !== undefined) {
      updatePayload.image_url = data.imageUrl.trim() || null;
    }

    if (data.categoryId !== undefined) {
      const newCategory = data.categoryId || null;
      if (newCategory) {
        const { data: category } = await adminClient
          .from('menu_categories')
          .select('id, active, is_archived')
          .eq('id', newCategory)
          .eq('restaurant_id', context.restaurantId)
          .maybeSingle();

        if (!category || category.is_archived) {
          throw new NotFoundError('Category not found for this restaurant');
        }

        if (!category.active && (data.active === true || existing.active)) {
          throw new ValidationError('Cannot assign active menu item to an inactive category');
        }
      }
      updatePayload.category_id = newCategory;
    }

    const { data: updated, error } = await adminClient
      .from('menu_items')
      .update(updatePayload)
      .eq('id', itemId)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError('Failed to update menu item');
    }

    const auditAction =
      data.active !== undefined && data.active !== existing.active
        ? data.active
          ? 'menu_item_activated'
          : 'menu_item_deactivated'
        : 'menu_item_updated';

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: auditAction,
      entity_type: 'menu_item',
      entity_id: itemId,
      metadata: updatePayload,
    });

    return updated;
  }

  static async archiveMenuItem(itemId: string, targetRestaurantId?: string, userId?: string) {
    const context = await this.getAuthorizedContext(targetRestaurantId, userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_DELETE,
    });

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('menu_items')
      .select('id, name, is_archived')
      .eq('id', itemId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Menu item not found');
    }

    if (existing.is_archived) {
      throw new DomainError('Menu item is already archived');
    }

    const { data: archived, error } = await adminClient
      .from('menu_items')
      .update({
        active: false,
        available: false,
        is_archived: true,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .select()
      .single();

    if (error || !archived) {
      throw new DomainError('Failed to archive menu item');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'menu_item_archived',
      entity_type: 'menu_item',
      entity_id: itemId,
      metadata: { name: existing.name },
    });

    return archived;
  }
}

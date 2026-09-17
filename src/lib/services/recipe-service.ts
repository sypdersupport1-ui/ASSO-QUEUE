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
import { z } from 'zod';
import type { InventoryUnit } from '@/types/database.types';

export const addIngredientSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item ID'),
  inventoryItemId: z.string().uuid('Invalid inventory item ID'),
  quantityRequired: z.number().positive('Quantity required must be greater than 0'),
});

export type AddIngredientInput = z.infer<typeof addIngredientSchema>;

export class RecipeService {
  /**
   * Resolve authorized restaurant ID for recipe operations.
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
      throw new AuthorizationError('Tenant mismatch: cannot access another restaurant recipe');
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

  static async listIngredients(
    menuItemId: string,
    params: { restaurantId?: string; userId?: string } = {}
  ) {
    const context = await this.getAuthorizedContext(params.restaurantId, params.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_VIEW,
    });

    const adminClient = createAdminClient();

    // Verify menu item tenant
    const { data: menuItem } = await adminClient
      .from('menu_items')
      .select('id, name')
      .eq('id', menuItemId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!menuItem) {
      throw new NotFoundError('Menu item not found');
    }

    const { data, error } = await adminClient
      .from('menu_item_ingredients')
      .select('*, inventory_items(id, name, unit, current_quantity, low_stock_threshold, is_active)')
      .eq('menu_item_id', menuItemId)
      .eq('restaurant_id', context.restaurantId);

    if (error) {
      throw new DomainError('Failed to list recipe ingredients');
    }

    const ingredients = (data || []).map((ing) => {
      const inv = ing.inventory_items as unknown as {
        id: string;
        name: string;
        unit: InventoryUnit;
        current_quantity: number;
        low_stock_threshold: number;
        is_active: boolean;
      } | null;

      return {
        id: ing.id,
        restaurantId: ing.restaurant_id,
        menuItemId: ing.menu_item_id,
        inventoryItemId: ing.inventory_item_id,
        inventoryItemName: inv?.name || 'Unknown',
        unit: inv?.unit || 'piece',
        currentQuantity: inv ? Number(inv.current_quantity) : 0,
        quantityRequired: Number(ing.quantity_required),
        isActive: inv?.is_active ?? true,
        createdAt: ing.created_at,
        updatedAt: ing.updated_at,
      };
    });

    return { menuItem, ingredients };
  }

  static async addIngredient(
    input: AddIngredientInput & { restaurantId?: string; userId?: string }
  ) {
    const context = await this.getAuthorizedContext(input.restaurantId, input.userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_UPDATE,
    });

    const parseResult = addIngredientSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid recipe ingredient details', {
        errors: parseResult.error.format(),
      });
    }

    const { menuItemId, inventoryItemId, quantityRequired } = parseResult.data;
    const adminClient = createAdminClient();

    // Verify Menu Item
    const { data: menuItem } = await adminClient
      .from('menu_items')
      .select('id, restaurant_id, is_archived')
      .eq('id', menuItemId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!menuItem || menuItem.is_archived) {
      throw new NotFoundError('Menu item not found or archived');
    }

    // Verify Inventory Item
    const { data: invItem } = await adminClient
      .from('inventory_items')
      .select('id, restaurant_id, is_active, is_archived')
      .eq('id', inventoryItemId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!invItem || invItem.is_archived) {
      throw new NotFoundError('Inventory item not found or archived');
    }

    if (!invItem.is_active) {
      throw new ValidationError('Cannot link an inactive inventory item to a recipe');
    }

    // Check duplicate recipe mapping
    const { data: existing } = await adminClient
      .from('menu_item_ingredients')
      .select('id')
      .eq('menu_item_id', menuItemId)
      .eq('inventory_item_id', inventoryItemId)
      .maybeSingle();

    if (existing) {
      throw new ConflictError('This ingredient is already mapped to this menu item');
    }

    const { data: created, error } = await adminClient
      .from('menu_item_ingredients')
      .insert({
        restaurant_id: context.restaurantId,
        menu_item_id: menuItemId,
        inventory_item_id: inventoryItemId,
        quantity_required: quantityRequired,
      })
      .select()
      .single();

    if (error || !created) {
      throw new DomainError(`Failed to add ingredient: ${error?.message || 'Unknown database error'}`);
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'recipe_mapping_created',
      entity_type: 'menu_item_ingredient',
      entity_id: created.id,
      metadata: { menuItemId, inventoryItemId, quantityRequired },
    });

    return created;
  }

  static async removeIngredient(
    ingredientId: string,
    targetRestaurantId?: string,
    userId?: string
  ) {
    const context = await this.getAuthorizedContext(targetRestaurantId, userId);
    await AuthorizationService.requirePermission({
      userId: context.userId,
      restaurantId: context.restaurantId,
      permission: PERMISSIONS.MENU_UPDATE,
    });

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient
      .from('menu_item_ingredients')
      .select('id, menu_item_id, inventory_item_id')
      .eq('id', ingredientId)
      .eq('restaurant_id', context.restaurantId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Recipe ingredient mapping not found');
    }

    const { error } = await adminClient
      .from('menu_item_ingredients')
      .delete()
      .eq('id', ingredientId)
      .eq('restaurant_id', context.restaurantId);

    if (error) {
      throw new DomainError('Failed to remove recipe ingredient');
    }

    await adminClient.from('audit_logs').insert({
      restaurant_id: context.restaurantId,
      actor_user_id: context.userId,
      action: 'recipe_mapping_removed',
      entity_type: 'menu_item_ingredient',
      entity_id: ingredientId,
      metadata: { menuItemId: existing.menu_item_id, inventoryItemId: existing.inventory_item_id },
    });

    return { success: true };
  }
}

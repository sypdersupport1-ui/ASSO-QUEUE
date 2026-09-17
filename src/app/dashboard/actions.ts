'use server';

import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { ZoneService } from '@/lib/services/zone-service';
import { TableService } from '@/lib/services/table-service';
import { MenuService } from '@/lib/services/menu-service';
import { InventoryService } from '@/lib/services/inventory-service';
import { RecipeService } from '@/lib/services/recipe-service';
import { QueueService } from '@/lib/services/queue-service';
import { OrderService } from '@/lib/services/order-service';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/db/supabase/admin';
import type { TableStatus, ZoneStatus, InventoryUnit, QueueStatus } from '@/types/database.types';

/**
 * Phase 3E: resolve the acting staff user from the server session.
 * Client-supplied actor ids (bound args / hidden form fields) are NEVER
 * trusted for authorization or audit attribution — a staff caller could
 * otherwise impersonate another user (including an admin) and inherit
 * their permissions. Falls back to the client value only when no session
 * exists (server-to-server/internal callers).
 */
async function resolveActionActor(clientActorId?: string): Promise<string | undefined> {
  try {
    const { requireAuth } = await import('@/lib/auth/session');
    const user = await requireAuth();
    return user.id;
  } catch {
    return clientActorId;
  }
}

/**
 * Session-derived actor for mutations whose service layer requires a
 * non-empty actor id. Fails closed when neither session nor fallback exists.
 */
async function requireActionActor(clientActorId?: string): Promise<string> {
  const resolved = await resolveActionActor(clientActorId);
  if (!resolved) {
    throw new Error('Authentication required.');
  }
  return resolved;
}

export async function updateProfileFormAction(_prevState: unknown, formData: FormData) {
  try {
    const input = {
      name: formData.get('name') as string,
      description: (formData.get('description') as string) || undefined,
      phone: (formData.get('phone') as string) || undefined,
      email: (formData.get('email') as string) || undefined,
      address: (formData.get('address') as string) || undefined,
      city: (formData.get('city') as string) || undefined,
      state: (formData.get('state') as string) || undefined,
      country: (formData.get('country') as string) || undefined,
      timezone: (formData.get('timezone') as string) || 'UTC',
      currency: (formData.get('currency') as string) || 'USD',
      seating_mode: (formData.get('seating_mode') as 'SIMPLE' | 'STRICT') || 'SIMPLE',
    };

    await RestaurantAdminService.updateRestaurantProfile(input);
    redirect('/dashboard/profile?updated=true');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update restaurant profile.',
    };
  }
}

export async function createStaffFormAction(_prevState: unknown, formData: FormData) {
  try {
    const input = {
      email: formData.get('email') as string,
      displayName: formData.get('displayName') as string,
      role: (formData.get('role') as 'STAFF' | 'RESTAURANT_ADMIN') || 'STAFF',
    };

    await RestaurantAdminService.createStaff(input);
    redirect('/dashboard/staff');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create staff member.',
    };
  }
}

export async function updateStaffStatusAction(targetUserId: string, newStatus: 'ACTIVE' | 'INACTIVE'): Promise<void> {
  try {
    await RestaurantAdminService.updateStaffStatus(targetUserId, newStatus);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update staff status.');
  }
  revalidatePath('/dashboard/staff');
}

export async function resendStaffInvitationAction(targetUserId: string): Promise<void> {
  try {
    await RestaurantAdminService.resendStaffInvitation(targetUserId);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to resend invitation.');
  }
  revalidatePath('/dashboard/staff');
}

export async function createZoneFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      name: formData.get('name') as string,
      description: (formData.get('description') as string) || undefined,
      sortOrder: parseInt((formData.get('sortOrder') as string) || '0', 10),
    };

    await ZoneService.createZone(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to create zone.');
  }
  revalidatePath('/dashboard/zones');
}

export async function updateZoneStatusAction(zoneId: string, status: ZoneStatus): Promise<void> {
  try {
    await ZoneService.updateZone(zoneId, { status });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update zone status.');
  }
  revalidatePath('/dashboard/zones');
}

export async function createTableFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      tableNumber: formData.get('tableNumber') as string,
      capacity: parseInt((formData.get('capacity') as string) || '2', 10),
      shape: (formData.get('shape') as 'ROUND' | 'SQUARE' | 'RECTANGLE' | 'BAR') || 'RECTANGLE',
      zoneId: (formData.get('zoneId') as string) || undefined,
    };

    await TableService.createTable(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to create table.');
  }
  revalidatePath('/dashboard/tables');
}

export async function bulkCreateTableFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      zoneId: formData.get('zoneId') as string,
      prefix: (formData.get('prefix') as string) || '',
      startNumber: parseInt((formData.get('startNumber') as string) || '1', 10),
      count: parseInt((formData.get('count') as string) || '10', 10),
      capacity: parseInt((formData.get('capacity') as string) || '4', 10),
      shape: (formData.get('shape') as 'ROUND' | 'SQUARE' | 'RECTANGLE' | 'BAR') || 'RECTANGLE',
    };

    await TableService.bulkCreateTables(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed bulk table creation.');
  }
  revalidatePath('/dashboard/tables');
}

export async function updateTableStatusAction(
  tableId: string,
  targetStatus: TableStatus,
  currentStatus?: TableStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    await TableService.updateTableStatus(tableId, targetStatus, currentStatus);
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/tables');
    revalidatePath('/dashboard/queue');
    revalidatePath('/dashboard', 'layout');
    return { success: true };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Failed to update table status.';
    return { success: false, error: message };
  }
}

export async function exitSeatedGuestAction(
  entryId: string,
  _tableId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
    await QueueService.exitSeatedCustomer(entryId, userId);
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/tables');
    revalidatePath('/dashboard/queue');
    revalidatePath('/dashboard', 'layout');
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to exit seated customer';
    return { success: false, error: message };
  }
}

export async function adminAddQueueGuestAction(formData: FormData): Promise<void> {
  try {
    const { restaurantId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
    const customerName = formData.get('customerName') as string;
    const customerPhone = (formData.get('customerPhone') as string) || undefined;
    const partySize = parseInt((formData.get('partySize') as string) || '1', 10);

    if (!customerName) {
      throw new Error('Customer name is required.');
    }

    await QueueService.joinQueue({
      restaurantId,
      customerName,
      customerPhone,
      partySize,
    });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to add guest to queue.');
  }
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard');
}

export async function archiveTableAction(tableId: string): Promise<void> {
  try {
    await TableService.archiveTable(tableId);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to archive table.');
  }
  revalidatePath('/dashboard/tables');
}

// --------------------------------------------------------------------------
// PHASE 7: MENU & INVENTORY SERVER ACTIONS
// --------------------------------------------------------------------------

export async function createCategoryFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      name: formData.get('name') as string,
      description: (formData.get('description') as string) || undefined,
      sortOrder: parseInt((formData.get('sortOrder') as string) || '0', 10),
    };

    await MenuService.createCategory(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to create menu category.');
  }
  revalidatePath('/dashboard/menu');
}

export async function updateCategoryStatusAction(categoryId: string, active: boolean): Promise<void> {
  try {
    await MenuService.updateCategory(categoryId, { active });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update category status.');
  }
  revalidatePath('/dashboard/menu');
}

export async function createMenuItemFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      name: formData.get('name') as string,
      categoryId: (formData.get('categoryId') as string) || undefined,
      description: (formData.get('description') as string) || undefined,
      price: parseFloat((formData.get('price') as string) || '0'),
      preparationTimeMinutes: parseInt((formData.get('preparationTimeMinutes') as string) || '15', 10),
      displayOrder: parseInt((formData.get('displayOrder') as string) || '0', 10),
      imageUrl: (formData.get('imageUrl') as string) || undefined,
    };

    await MenuService.createMenuItem(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to create menu item.');
  }
  revalidatePath('/dashboard/menu');
}

export async function updateMenuItemAvailabilityAction(itemId: string, available: boolean): Promise<void> {
  try {
    await MenuService.updateMenuItem(itemId, { available });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update item availability.');
  }
  revalidatePath('/dashboard/menu');
}

export async function archiveMenuItemAction(itemId: string): Promise<void> {
  try {
    await MenuService.archiveMenuItem(itemId);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to archive menu item.');
  }
  revalidatePath('/dashboard/menu');
}

export async function createInventoryItemFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      name: formData.get('name') as string,
      sku: (formData.get('sku') as string) || undefined,
      unit: formData.get('unit') as InventoryUnit,
      openingQuantity: parseFloat((formData.get('openingQuantity') as string) || '0'),
      lowStockThreshold: parseFloat((formData.get('lowStockThreshold') as string) || '0'),
    };

    await InventoryService.createInventoryItem(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to create inventory item.');
  }
  revalidatePath('/dashboard/inventory');
}

export async function archiveInventoryItemAction(itemId: string): Promise<void> {
  try {
    await InventoryService.archiveInventoryItem(itemId);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to archive inventory item.');
  }
  revalidatePath('/dashboard/inventory');
}

export async function adjustStockFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      inventoryItemId: formData.get('inventoryItemId') as string,
      movementType: formData.get('movementType') as 'PURCHASE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'WASTE' | 'CORRECTION' | 'INITIAL',
      quantity: parseFloat((formData.get('quantity') as string) || '0'),
      reason: formData.get('reason') as string,
    };

    await InventoryService.adjustStock(input);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to adjust inventory stock.');
  }
  revalidatePath('/dashboard/inventory');
}

export async function addIngredientFormAction(formData: FormData): Promise<void> {
  try {
    const input = {
      menuItemId: formData.get('menuItemId') as string,
      inventoryItemId: formData.get('inventoryItemId') as string,
      quantityRequired: parseFloat((formData.get('quantityRequired') as string) || '0'),
    };

    await RecipeService.addIngredient(input);

  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to link recipe ingredient.');
  }
  revalidatePath('/dashboard/menu');
}

export async function removeIngredientAction(ingredientId: string, _menuItemId: string): Promise<void> {
  try {
    await RecipeService.removeIngredient(ingredientId);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to remove recipe ingredient.');
  }
  revalidatePath('/dashboard/menu');
}

// --------------------------------------------------------------------------
// QUEUE ACTIONS — use revalidatePath() instead of redirect() to avoid full
// browser navigations. The page data refreshes in-place (no URL change, no
// scroll-position reset, no loading bar flash).
// --------------------------------------------------------------------------

export async function updateQueueStatusAction(entryId: string, newStatus: QueueStatus, actorUserId?: string, reason?: string | FormData): Promise<void> {
  try {
    // When used as <form action={fn.bind(null, a,b,c)}>, Next.js passes FormData as last arg
    let effectiveReason: string | undefined = typeof reason === 'string' ? reason : undefined;
    if (!effectiveReason && reason instanceof FormData) {
      effectiveReason = (reason.get('reason') as string) || undefined;
    }
    const clientActorId: string | undefined = typeof actorUserId === 'string' ? actorUserId : undefined;
    // Phase 3E: session identity always wins over the client-supplied id.
    const effectiveActorId = await resolveActionActor(clientActorId);
    await QueueService.updateQueueStatus({ entryId, newStatus, actorUserId: effectiveActorId, reason: effectiveReason });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update queue entry status.');
  }
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard', 'layout');
}

export async function markNoShowAction(formData: FormData): Promise<void> {
  const entryId = formData.get('entryId') as string;
  const reason = (formData.get('reason') as string) || 'STAFF_MARKED_NO_SHOW';
  const actorUserId = formData.get('actorUserId') as string | undefined;
  await updateQueueStatusAction(entryId, 'NO_SHOW', actorUserId, reason);
}

export async function toggleQueueOpenAction(restaurantId: string, open: boolean, actorUserId: string): Promise<void> {
  try {
    await QueueService.toggleQueueOpen(restaurantId, open, await requireActionActor(actorUserId));
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to toggle queue state.');
  }
  revalidatePath('/dashboard/queue');
}

export async function setQueueOperatingStateAction(restaurantId: string, newState: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED', actorUserId: string, reason?: string): Promise<void> {
  try {
    await QueueService.setQueueOperatingState(restaurantId, newState as unknown as import('@/types/database.types').QueueOperatingState, await requireActionActor(actorUserId), reason);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to set queue operating state.');
  }
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard', 'layout');
}

export async function setQueueOperatingStateFormAction(formData: FormData): Promise<void> {
  const restaurantId = formData.get('restaurantId') as string;
  const newState = formData.get('newState') as 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
  const actorUserId = formData.get('actorUserId') as string;
  const reason = (formData.get('reason') as string) || undefined;
  await setQueueOperatingStateAction(restaurantId, newState, actorUserId, reason);
}

export async function updateQueueScheduleFormAction(formData: FormData): Promise<void> {
  try {
    const { RestaurantAdminService } = await import('@/lib/services/restaurant-admin-service');
    const { QueueScheduleService } = await import('@/lib/services/queue-schedule-service');
    const { restaurantId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
    const { requireAuth } = await import('@/lib/auth/session');
    const user = await requireAuth();
    const days: Array<{ day_of_week: number; opens_at: string; closes_at: string; is_closed: boolean }> = [];
    for (let d = 0; d <= 6; d++) {
      days.push({
        day_of_week: d,
        opens_at: (formData.get(`opens_${d}`) as string) || '00:00',
        closes_at: (formData.get(`closes_${d}`) as string) || '23:59',
        is_closed: formData.get(`closed_${d}`) === 'on',
      });
    }
    await QueueScheduleService.updateSchedule(restaurantId, user.id, days);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update queue schedule.');
  }
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard', 'layout');
}

export async function updateQueueSettingsFormAction(formData: FormData): Promise<void> {
  try {
    const restaurantId = formData.get('restaurantId') as string;
    const actorUserId = formData.get('actorUserId') as string;
    const settings = {
      maxQueueCapacity: parseInt((formData.get('maxQueueCapacity') as string) || '100', 10),
      minPartySize: parseInt((formData.get('minPartySize') as string) || '1', 10),
      maxPartySize: parseInt((formData.get('maxPartySize') as string) || '20', 10),
      callTimeoutMinutes: parseInt((formData.get('callTimeoutMinutes') as string) || '15', 10),
      autoExpireCalled: formData.get('autoExpireCalled') === 'true' || formData.get('autoExpireCalled') === 'on',
    };

    await QueueService.updateQueueSettings(restaurantId, settings, await requireActionActor(actorUserId));
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update queue settings.');
  }
  revalidatePath('/dashboard/queue');
}

export async function seatQueueEntryAction(
  entryId: string,
  tableId: string,
  actorUserId?: string,
  actualGuests?: number,
  additionalTableIds?: string[]
): Promise<void> {
  try {
    await QueueService.seatQueueEntry(
      entryId,
      tableId,
      await resolveActionActor(actorUserId),
      actualGuests,
      additionalTableIds
    );
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to seat queue entry.');
  }
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard/tables');
  revalidatePath('/dashboard', 'layout');
}

export async function updateSeatingModeAction(newMode: 'SIMPLE' | 'STRICT'): Promise<{ success: boolean; error?: string }> {
  try {
    const { restaurantId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from('restaurants')
      .update({
        seating_mode: newMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', restaurantId);

    if (error) throw error;

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/tables');
    revalidatePath('/dashboard/profile');
    revalidatePath('/dashboard', 'layout');
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update seating mode',
    };
  }
}

export async function updateETASettingsFormAction(formData: FormData): Promise<void> {
  try {
    const restaurantId = formData.get('restaurantId') as string;
    const actorUserId = formData.get('actorUserId') as string;
    const settings = {
      avgServiceTimeMins: parseInt((formData.get('avgServiceTimeMins') as string) || '15', 10),
      serviceCapacityUnits: parseInt((formData.get('serviceCapacityUnits') as string) || '3', 10),
      etaBufferMins: parseInt((formData.get('etaBufferMins') as string) || '5', 10),
      almostYourTurnThreshold: parseInt((formData.get('almostYourTurnThreshold') as string) || '3', 10),
    };

    await QueueService.updateETASettings(restaurantId, settings, await requireActionActor(actorUserId));
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('Failed to update ETA settings.');
  }
  revalidatePath('/dashboard/queue');
}

export async function createCustomerOrderAction(input: {
  restaurantId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  queueEntryId?: string | null;
  tableId?: string | null;
  idempotencyKey?: string | null;
  /** Customer queue bearer token — REQUIRED when queueEntryId is present. */
  queueToken?: string | null;
  items: { menuItemId: string; quantity: number; notes?: string | null }[];
}) {
  // Phase 3D — bind anonymous order creation to queue-token authorization.
  // A queueEntryId claimed without (or with a mismatched) token is rejected:
  // the authorized entry is derived SOLELY from hash(queueToken) and both
  // the restaurant and entry must match. Server Actions are directly
  // callable, so UI flow alone is never sufficient authorization.
  if (input.queueEntryId) {
    if (!input.queueToken) {
      throw new Error('Invalid queue authorization. Please rejoin from your ticket.');
    }
    const status = await QueueService.getQueueStatusByToken(input.queueToken);
    if (
      !status ||
      status.restaurantId !== input.restaurantId ||
      status.entryId !== input.queueEntryId
    ) {
      throw new Error('Invalid queue authorization. Please rejoin from your ticket.');
    }
  }

  // Phase 3D — order creation is rate-limited even via direct action calls.
  const {
    checkRateLimit,
    RateLimitEndpointClass,
    RateLimitLimit,
    generateOrderCreateIdentifier,
    getActionClientIp,
  } = await import('@/lib/rate-limit');
  const orderLimit = await checkRateLimit({
    identifier: generateOrderCreateIdentifier(input.restaurantId, await getActionClientIp()),
    limit: RateLimitLimit.ORDER_CREATION,
    windowSeconds: 60,
    endpointClass: RateLimitEndpointClass.HIGH_COST,
  });
  if (!orderLimit.allowed) {
    throw new Error('Too many order attempts. Please wait a moment and try again.');
  }

  const { queueToken: _queueToken, ...orderInput } = input;
  const result = await OrderService.createCustomerOrder(orderInput);
  return result;
}

export async function updateOrderStatusAction(
  orderId: string,
  targetStatus: 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED',
  restaurantId?: string,
  userId?: string
) {
  const updated = await OrderService.updateOrderStatus({
    orderId,
    targetStatus,
    restaurantId,
    userId: await resolveActionActor(userId),
  });
  revalidatePath('/dashboard/orders');
  revalidatePath('/dashboard/kitchen');
  return updated;
}

export async function updateKitchenStatusAction(
  orderId: string,
  targetStatus: 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED',
  restaurantId?: string,
  userId?: string
) {
  const updated = await OrderService.updateOrderStatus({
    orderId,
    targetStatus,
    restaurantId,
    userId: await resolveActionActor(userId),
  });
  revalidatePath('/dashboard/kitchen');
  revalidatePath('/dashboard/orders');
  return updated;
}

export async function recommendTablesAction(queueEntryId: string): Promise<Array<{
  id: string;
  table_number: string;
  capacity: number;
  restaurant_zones?: { name: string } | null;
  is_combination?: boolean;
  is_shared?: boolean;
  table_ids?: string[];
  combination_labels?: string[];
  reason?: string;
}>> {
  // Phase 3E: bind the recommendation read to the caller's session so the
  // service enforces QUEUE_VIEW on the entry's restaurant (previously no
  // actor was passed, skipping the check entirely).
  const actorId = await resolveActionActor(undefined);
  const result = await QueueService.recommendTablesForQueueEntry(queueEntryId, actorId);
  return result.map(r => ({
    id: r.table_id,
    table_number: r.table_number,
    capacity: r.capacity,
    restaurant_zones: r.zone_name ? { name: r.zone_name } : null,
    is_combination: r.is_combination ?? false,
    is_shared: r.is_shared ?? false,
    table_ids: r.table_ids ?? [r.table_id],
    combination_labels: r.combination_labels ?? [r.table_number],
    reason: r.reason,
  }));
}

export async function recordCustomerLateAction(rawToken: string, delayMinutes: number, note: string) {
  const result = await QueueService.recordCustomerLate(rawToken, delayMinutes, note);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  return result;
}

export async function sendQueueChatMessageAction(params: {
  rawToken?: string;
  queueEntryId?: string;
  message: string;
}) {
  let sender: 'customer' | 'staff' = 'customer';
  let actorUserId: string | undefined;
  let restaurantId: string | undefined;

  if (params.queueEntryId) {
    sender = 'staff';
    actorUserId = await resolveActionActor(undefined);
    const ctx = await AuthorizationService.requirePermission({ permission: PERMISSIONS.QUEUE_VIEW });
    restaurantId = ctx.restaurantId;
  }

  const result = await QueueService.sendQueueChatMessage({
    rawToken: params.rawToken,
    queueEntryId: params.queueEntryId,
    restaurantId,
    sender,
    message: params.message,
    actorUserId,
  });

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  return result;
}

export async function passTableToNextAction(queueEntryId: string) {
  const actorUserId = await resolveActionActor(undefined);
  const ctx = await AuthorizationService.requirePermission({ permission: PERMISSIONS.QUEUE_VIEW });
  if (!ctx.restaurantId) throw new Error('NO_RESTAURANT_ASSIGNED');

  const result = await QueueService.passTableToNextCustomer(queueEntryId, ctx.restaurantId, actorUserId);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  return result;
}

export async function getQueueChatHistoryAction(queueEntryId: string) {
  return await QueueService.getQueueChatHistory(queueEntryId);
}

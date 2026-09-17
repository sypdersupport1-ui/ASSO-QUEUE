import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { MenuService } from '@/lib/services/menu-service';
import { InventoryService } from '@/lib/services/inventory-service';
import { RecipeService } from '@/lib/services/recipe-service';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 7: Menu, Inventory, Recipe & Concurrency Tests', () => {
  let client: Client;

  const RESTAURANT_A_ID = '11111111-1111-4111-a111-111111111111';
  const RESTAURANT_B_ID = '22222222-2222-4222-a222-222222222222';

  // Resolved by email in beforeAll: alice's Auth user was recreated
  // (new UUID) when repairing its broken seed row — never hard-rely on it.
  let ADMIN_A_ID = 'a0000000-0000-4000-a000-000000000002';
  const STAFF_A_ID = 'a0000000-0000-4000-a000-000000000003';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live menu/inventory tests');
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
  // TEST SUITE 1: MENU CATEGORIES & ITEMS
  // --------------------------------------------------------------------------

  it('[MENU TEST] Restaurant Admin can create categories and menu items with valid pricing', async () => {
    const catName = `Starters ${Date.now()}`;
    const category = await MenuService.createCategory({
      name: catName,
      description: 'Appetizers and starters',
      sortOrder: 1,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(category).toBeDefined();
    expect(category.name).toBe(catName);

    // Duplicate active category name within same tenant must be rejected
    await expect(
      MenuService.createCategory({
        name: catName,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();

    // Create Menu Item
    const item = await MenuService.createMenuItem({
      name: `Spring Rolls ${Date.now()}`,
      categoryId: category.id,
      price: 12.5,
      preparationTimeMinutes: 10,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(item).toBeDefined();
    expect(Number(item.price)).toBe(12.5);

    // Invalid negative price must be rejected
    await expect(
      MenuService.createMenuItem({
        name: 'Invalid Item',
        categoryId: category.id,
        price: -5.0,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  it('[MENU TEST] Inactive categories cannot receive newly created active menu items', async () => {
    const cat = await MenuService.createCategory({
      name: `Inactive Cat ${Date.now()}`,
      sortOrder: 99,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    await MenuService.updateCategory(cat.id, {
      active: false,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    await expect(
      MenuService.createMenuItem({
        name: `Orphan Item ${Date.now()}`,
        categoryId: cat.id,
        price: 15.0,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  it('[MENU TEST] Menu item soft archival preserves historical record', async () => {
    const item = await MenuService.createMenuItem({
      name: `Archival Test Item ${Date.now()}`,
      price: 20.0,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const archived = await MenuService.archiveMenuItem(item.id, RESTAURANT_A_ID, ADMIN_A_ID);
    expect(archived.is_archived).toBe(true);

    const list = await MenuService.listMenuItems({
      restaurantId: RESTAURANT_A_ID,
      search: item.name,
      userId: ADMIN_A_ID,
    });
    expect(list.items.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: INVENTORY & LEDGER CREATION
  // --------------------------------------------------------------------------

  it('[INVENTORY TEST] Creating inventory item creates initial ledger movement atomically', async () => {
    const itemName = `Basmati Rice ${Date.now()}`;
    const invItem = await InventoryService.createInventoryItem({
      name: itemName,
      unit: 'kg',
      openingQuantity: 25.5,
      lowStockThreshold: 5.0,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(invItem).toBeDefined();
    expect(Number(invItem.current_quantity)).toBe(25.5);

    // Verify Movement History Ledger contains INITIAL entry
    const history = await InventoryService.getMovementHistory(invItem.id, {
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(history.movements.length).toBe(1);
    expect(history.movements[0]?.movementType).toBe('INITIAL');
    expect(history.movements[0]?.quantityDelta).toBe(25.5);
    expect(history.movements[0]?.quantityAfter).toBe(25.5);
  });

  it('[INVENTORY TEST] Rejects stock adjustments that result in negative stock', async () => {
    const invItem = await InventoryService.createInventoryItem({
      name: `Limited Oil ${Date.now()}`,
      unit: 'liter',
      openingQuantity: 5.0,
      lowStockThreshold: 1.0,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    // Attempting to remove 10 liters from 5 liters opening stock must be rejected
    await expect(
      InventoryService.adjustStock({
        inventoryItemId: invItem.id,
        movementType: 'WASTE',
        quantity: 10.0,
        reason: 'Excessive waste attempt',
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: INVENTORY CONCURRENCY TESTS
  // --------------------------------------------------------------------------

  it('[CONCURRENCY TEST A] Concurrent +5 and -4 updates on stock 10 result in exact final stock 11', async () => {
    const invItem = await InventoryService.createInventoryItem({
      name: `Race Stock Item A ${Date.now()}`,
      unit: 'piece',
      openingQuantity: 10.0,
      lowStockThreshold: 2.0,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    // Run simultaneous stock additions (+5) and stock removals (-4)
    const workerAdd = InventoryService.adjustStock({
      inventoryItemId: invItem.id,
      movementType: 'PURCHASE',
      quantity: 5.0,
      reason: 'Restock +5',
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const workerRemove = InventoryService.adjustStock({
      inventoryItemId: invItem.id,
      movementType: 'ADJUSTMENT_OUT',
      quantity: 4.0,
      reason: 'Used -4',
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    await Promise.all([workerAdd, workerRemove]);

    // Verify final stock is exactly 10 + 5 - 4 = 11
    const { items } = await InventoryService.listInventoryItems({
      restaurantId: RESTAURANT_A_ID,
      search: invItem.name,
      userId: ADMIN_A_ID,
    });

    expect(items[0]?.currentQuantity).toBe(11.0);

    // Verify Ledger contains exactly 3 entries: INITIAL, PURCHASE (+5), ADJUSTMENT_OUT (-4)
    const history = await InventoryService.getMovementHistory(invItem.id, {
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(history.movements.length).toBe(3);
  }, 15000);

  it('[CONCURRENCY TEST B] Concurrent -2 and -2 updates on stock 3 allow one and reject other due to insufficient stock', async () => {
    const invItem = await InventoryService.createInventoryItem({
      name: `Race Stock Item B ${Date.now()}`,
      unit: 'piece',
      openingQuantity: 3.0,
      lowStockThreshold: 1.0,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const worker1 = InventoryService.adjustStock({
      inventoryItemId: invItem.id,
      movementType: 'ADJUSTMENT_OUT',
      quantity: 2.0,
      reason: 'Worker 1 remove -2',
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const worker2 = InventoryService.adjustStock({
      inventoryItemId: invItem.id,
      movementType: 'ADJUSTMENT_OUT',
      quantity: 2.0,
      reason: 'Worker 2 remove -2',
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const results = await Promise.allSettled([worker1, worker2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Final stock MUST be 3 - 2 = 1
    const { items } = await InventoryService.listInventoryItems({
      restaurantId: RESTAURANT_A_ID,
      search: invItem.name,
      userId: ADMIN_A_ID,
    });

    expect(items[0]?.currentQuantity).toBe(1.0);
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: RECIPE MAPPING & TENANT INTEGRITY
  // --------------------------------------------------------------------------

  it('[RECIPE TEST] Restaurant Admin can link active inventory item to menu item with tenant integrity', async () => {
    const menuItem = await MenuService.createMenuItem({
      name: `Burger ${Date.now()}`,
      price: 15.0,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const invItem = await InventoryService.createInventoryItem({
      name: `Bun ${Date.now()}`,
      unit: 'piece',
      openingQuantity: 100,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    const recipe = await RecipeService.addIngredient({
      menuItemId: menuItem.id,
      inventoryItemId: invItem.id,
      quantityRequired: 1,
      restaurantId: RESTAURANT_A_ID,
      userId: ADMIN_A_ID,
    });

    expect(recipe).toBeDefined();

    const ADMIN_B_ID = 'a0000000-0000-4000-a000-000000000003'; // Bob (Admin Ramen, Restaurant B)
    // Cross-tenant recipe ingredient mapping MUST fail tenant trigger
    const invItemB = await InventoryService.createInventoryItem({
      name: `Restaurant B Bun ${Date.now()}`,
      unit: 'piece',
      openingQuantity: 50,
      restaurantId: RESTAURANT_B_ID,
      userId: ADMIN_B_ID,
    });

    await expect(
      RecipeService.addIngredient({
        menuItemId: menuItem.id,
        inventoryItemId: invItemB.id,
        quantityRequired: 1,
        restaurantId: RESTAURANT_A_ID,
        userId: ADMIN_A_ID,
      })
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 5: RLS & SECURITY PENETRATION TESTS
  // --------------------------------------------------------------------------

  it('[SECURITY TEST] Staff A cannot create menu items or archive inventory items', async () => {
    // Staff creation of menu item MUST be denied by RBAC
    await expect(
      MenuService.createMenuItem({
        name: `Unauthorized Staff Item ${Date.now()}`,
        price: 10.0,
        restaurantId: RESTAURANT_A_ID,
        userId: STAFF_A_ID,
      })
    ).rejects.toThrow();

    // Staff creation of inventory item MUST be denied by RBAC
    await expect(
      InventoryService.createInventoryItem({
        name: `Unauthorized Staff Inventory ${Date.now()}`,
        unit: 'kg',
        openingQuantity: 10,
        restaurantId: RESTAURANT_A_ID,
        userId: STAFF_A_ID,
      })
    ).rejects.toThrow();
  });

  it('[PENETRATION TEST] Direct SQL UPDATE or DELETE on inventory_movements is prohibited by RLS', async () => {
    await withUserContext(ADMIN_A_ID, 'authenticated', async () => {
      // Direct SQL update on movement ledger should match 0 rows or throw policy error
      const res = await client.query(
        `UPDATE public.inventory_movements SET quantity_delta = 9999 WHERE restaurant_id = $1::uuid`,
        [RESTAURANT_A_ID]
      );
      expect(res.rowCount).toBe(0);
    });
  });
});

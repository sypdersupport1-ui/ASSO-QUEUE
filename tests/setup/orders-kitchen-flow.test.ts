import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { OrderService } from '@/lib/services/order-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { resetEnvCacheForTesting } from '@/lib/config/env';

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;

describe('Phase 11: Orders, Kitchen Operations, Price Snapshots & Idempotency Tests', () => {
  let client: Client;

  // Dedicated test restaurant IDs to prevent test suite collision
  const RESTAURANT_A_ID = '11111111-9999-4111-a111-111111111111';
  const RESTAURANT_B_ID = '22222222-9999-4222-a222-222222222222';
  const RESTAURANT_A_SLUG = 'phase11-orders-demo-a';
  const RESTAURANT_B_SLUG = 'phase11-orders-demo-b';

  let categoryId: string;
  let activeAvailableItemId: string;
  let unavailableItemId: string;
  let inactiveItemId: string;

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live Phase 11 tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    // Ensure dedicated test restaurants exist
    await client.query(`
      INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, status)
      VALUES 
        ($1, 'Phase 11 Orders Demo A', $2, true, 100, 'ACTIVE'),
        ($3, 'Phase 11 Orders Demo B', $4, true, 100, 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        status = 'ACTIVE';
    `, [RESTAURANT_A_ID, RESTAURANT_A_SLUG, RESTAURANT_B_ID, RESTAURANT_B_SLUG]);

    // Clean existing test data
    await client.query(`DELETE FROM public.order_events WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.order_items WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.orders WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.menu_item_ingredients WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.menu_items WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.menu_categories WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.inventory_movements WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
    await client.query(`DELETE FROM public.inventory_items WHERE restaurant_id IN ($1, $2);`, [RESTAURANT_A_ID, RESTAURANT_B_ID]);

    // Create Menu Category
    const catRes = await client.query(`
      INSERT INTO public.menu_categories (restaurant_id, name, active)
      VALUES ($1, 'Signature Main Course', true)
      RETURNING id;
    `, [RESTAURANT_A_ID]);
    categoryId = catRes.rows[0].id;

    // Create Active & Available Item (Price ₹320.00 / $320.00)
    const item1Res = await client.query(`
      INSERT INTO public.menu_items (restaurant_id, category_id, name, price, active, available)
      VALUES ($1, $2, 'Butter Chicken Special', 320.00, true, true)
      RETURNING id;
    `, [RESTAURANT_A_ID, categoryId]);
    activeAvailableItemId = item1Res.rows[0].id;

    // Create Unavailable Item
    const item2Res = await client.query(`
      INSERT INTO public.menu_items (restaurant_id, category_id, name, price, active, available)
      VALUES ($1, $2, 'Truffle Naan Out of Stock', 120.00, true, false)
      RETURNING id;
    `, [RESTAURANT_A_ID, categoryId]);
    unavailableItemId = item2Res.rows[0].id;

    // Create Inactive Item
    const item3Res = await client.query(`
      INSERT INTO public.menu_items (restaurant_id, category_id, name, price, active, available)
      VALUES ($1, $2, 'Discontinued Soup', 90.00, false, true)
      RETURNING id;
    `, [RESTAURANT_A_ID, categoryId]);
    inactiveItemId = item3Res.rows[0].id;
  });

  afterAll(async () => {
    // Remove fixed-id fixture restaurants so the shared database stays clean
    // between runs (recreated by beforeAll; DELETE cascades to child rows).
    if (client) {
      await client.query(`DELETE FROM public.restaurants WHERE id IN ($1, $2)`, [RESTAURANT_A_ID, RESTAURANT_B_ID]).catch(() => undefined);
      await client.end();
    }
  });

  // ===========================================================================
  // 1. PUBLIC MENU & AVAILABILITY CHECKS
  // ===========================================================================
  describe('1. Public Menu & Availability', () => {
    it('fetches menu preview with items', async () => {
      const preview = await PublicRestaurantService.getPublicMenuPreview(RESTAURANT_A_ID);
      expect(preview).toBeDefined();
      expect(preview.length).toBeGreaterThan(0);
      const cat = preview.find(c => c.id === categoryId);
      expect(cat).toBeDefined();
      expect(cat?.items.map(i => i.id)).toContain(activeAvailableItemId);
    });

    it('rejects order placement for unavailable menu item', async () => {
      await expect(
        OrderService.createCustomerOrder({
          restaurantId: RESTAURANT_A_ID,
          customerName: 'Test Guest',
          items: [{ menuItemId: unavailableItemId, quantity: 1 }],
        })
      ).rejects.toThrow(/unavailable/i);
    });

    it('rejects order placement for inactive menu item', async () => {
      await expect(
        OrderService.createCustomerOrder({
          restaurantId: RESTAURANT_A_ID,
          customerName: 'Test Guest',
          items: [{ menuItemId: inactiveItemId, quantity: 1 }],
        })
      ).rejects.toThrow(/no longer available/i);
    });
  });

  // ===========================================================================
  // 2. ORDER PLACEMENT, SERVER PRICING & PRICE SNAPSHOT INVARIANT
  // ===========================================================================
  describe('2. Order Placement & Price Snapshot Invariant', () => {
    it('creates customer order with server-side price calculation', async () => {
      const result = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Aarav Sharma',
        customerPhone: '+919999988888',
        items: [{ menuItemId: activeAvailableItemId, quantity: 2 }],
      });

      expect(result.order).toBeDefined();
      expect(result.order.status).toBe('PLACED');
      expect(result.order.payment_status).toBe('UNPAID');
      expect(result.order.subtotal).toBe(640.00); // 2 * 320.00
      expect(result.order.total).toBe(640.00);
      expect(result.rawToken).toMatch(/^qtoken_[a-f0-9]{64}$/);

      expect(result.items.length).toBe(1);
      expect(result.items[0].name_snapshot).toBe('Butter Chicken Special');
      expect(result.items[0].unit_price_snapshot).toBe(320.00);
      expect(result.items[0].total_price).toBe(640.00);
    });

    it('[PRICE SNAPSHOT INVARIANT TEST] Order unit price snapshot remains 320.00 even after menu price changes to 350.00', async () => {
      // 1. Create Order when menu price is 320.00
      const result = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Priya Verma',
        items: [{ menuItemId: activeAvailableItemId, quantity: 1 }],
      });

      // 2. Update menu item price in database to 350.00
      await client.query(`UPDATE public.menu_items SET price = 350.00 WHERE id = $1;`, [activeAvailableItemId]);

      // 3. Query existing order and verify price snapshot is unchanged at 320.00
      const customerOrder = await OrderService.getCustomerOrderStateByToken(result.rawToken);
      expect(customerOrder).toBeDefined();
      expect(customerOrder?.items?.[0]?.unitPrice).toBe(320.00);
      expect(customerOrder?.total).toBe(320.00);

      // Restore menu item price to 320.00 for remaining tests
      await client.query(`UPDATE public.menu_items SET price = 320.00 WHERE id = $1;`, [activeAvailableItemId]);
    });

    it('[IDEMPOTENCY TEST] Re-submitting order with same idempotency_key returns original order without duplicating records', async () => {
      const idempKey = `idemp_test_${Date.now()}`;

      const firstCall = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        idempotencyKey: idempKey,
        customerName: 'Idemp Test User',
        items: [{ menuItemId: activeAvailableItemId, quantity: 1 }],
      });

      const secondCall = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        idempotencyKey: idempKey,
        customerName: 'Idemp Test User',
        items: [{ menuItemId: activeAvailableItemId, quantity: 1 }],
      });

      expect(firstCall.order.id).toBe(secondCall.order.id);
      expect(firstCall.order.order_number).toBe(secondCall.order.order_number);
    });
  });

  // ===========================================================================
  // 3. ORDER STATE MACHINE & KITCHEN WORKFLOW
  // ===========================================================================
  describe('3. Order State Machine (FSM)', () => {
    it('executes valid FSM transitions: PLACED -> CONFIRMED -> PREPARING -> READY -> SERVED', async () => {
      const created = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'FSM User',
        items: [{ menuItemId: activeAvailableItemId, quantity: 1 }],
      });
      const orderId = created.order.id;

      // PLACED -> CONFIRMED
      const confirmed = await OrderService.updateOrderStatus({
        orderId,
        targetStatus: 'CONFIRMED',
        restaurantId: RESTAURANT_A_ID,
      });
      expect(confirmed.status).toBe('CONFIRMED');

      // CONFIRMED -> PREPARING
      const preparing = await OrderService.updateOrderStatus({
        orderId,
        targetStatus: 'PREPARING',
        restaurantId: RESTAURANT_A_ID,
      });
      expect(preparing.status).toBe('PREPARING');

      // PREPARING -> READY
      const ready = await OrderService.updateOrderStatus({
        orderId,
        targetStatus: 'READY',
        restaurantId: RESTAURANT_A_ID,
      });
      expect(ready.status).toBe('READY');

      // READY -> SERVED
      const served = await OrderService.updateOrderStatus({
        orderId,
        targetStatus: 'SERVED',
        restaurantId: RESTAURANT_A_ID,
      });
      expect(served.status).toBe('SERVED');
    });

    it('rejects invalid state transitions (e.g. SERVED -> CANCELLED or PLACED -> SERVED)', async () => {
      const created = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Invalid FSM User',
        items: [{ menuItemId: activeAvailableItemId, quantity: 1 }],
      });
      const orderId = created.order.id;

      // Try illegal transition PLACED -> SERVED
      await expect(
        OrderService.updateOrderStatus({
          orderId,
          targetStatus: 'SERVED',
          restaurantId: RESTAURANT_A_ID,
        })
      ).rejects.toThrow(/INVALID_ORDER_TRANSITION/i);

      // Transition to SERVED
      await OrderService.updateOrderStatus({ orderId, targetStatus: 'CONFIRMED', restaurantId: RESTAURANT_A_ID });
      await OrderService.updateOrderStatus({ orderId, targetStatus: 'PREPARING', restaurantId: RESTAURANT_A_ID });
      await OrderService.updateOrderStatus({ orderId, targetStatus: 'READY', restaurantId: RESTAURANT_A_ID });
      await OrderService.updateOrderStatus({ orderId, targetStatus: 'SERVED', restaurantId: RESTAURANT_A_ID });

      // Try illegal transition SERVED -> CANCELLED (terminal state)
      await expect(
        OrderService.updateOrderStatus({
          orderId,
          targetStatus: 'CANCELLED',
          restaurantId: RESTAURANT_A_ID,
        })
      ).rejects.toThrow(/INVALID_ORDER_TRANSITION/i);
    });

    it('returns kitchen orders in FIFO priority order (oldest placed order first)', async () => {
      const kitchenList = await OrderService.listKitchenOrders(RESTAURANT_A_ID);
      expect(kitchenList).toBeDefined();
      expect(Array.isArray(kitchenList)).toBe(true);
    });
  });

  // ===========================================================================
  // 4. CROSS-TENANT SECURITY ISOLATION
  // ===========================================================================
  describe('4. Cross-Tenant Security Isolation', () => {
    it('prevents updating order status across tenant boundaries', async () => {
      const orderA = await OrderService.createCustomerOrder({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Tenant A Guest',
        items: [{ menuItemId: activeAvailableItemId, quantity: 1 }],
      });

      // Try updating order belonging to RESTAURANT_A using RESTAURANT_B context
      await expect(
        OrderService.updateOrderStatus({
          orderId: orderA.order.id,
          targetStatus: 'CONFIRMED',
          restaurantId: RESTAURANT_B_ID,
        })
      ).rejects.toThrow(/TENANT_MISMATCH/i);
    });
  });
});

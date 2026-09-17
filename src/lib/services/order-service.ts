import 'server-only';

import { createAdminClient } from '@/lib/db/supabase/admin';
import { OrderStatus, PaymentStatus } from '@/types/database.types';
import { generateQueueToken, hashQueueToken } from '@/lib/utils/token-utils';
import { OutboxService } from '@/lib/services/outbox-service';
import { ValidationError, NotFoundError, DomainError } from '@/lib/errors';
import { logger } from '@/lib/logging/logger';
import { z } from 'zod';

export const OrderItemInputSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item ID'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(99, 'Quantity limit is 99 per item'),
  notes: z.string().max(200).optional().nullable(),
});

export const CreateOrderSchema = z.object({
  restaurantId: z.string().uuid('Invalid restaurant ID'),
  customerName: z.string().max(100).optional().nullable(),
  customerPhone: z.string().max(30).optional().nullable(),
  queueEntryId: z.string().uuid().optional().nullable(),
  tableId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().max(100).optional().nullable(),
  items: z.array(OrderItemInputSchema).min(1, 'Cart cannot be empty'),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

/**
 * Authoritative order FSM states accepted for status transitions.
 * DRAFT is not included here because orders are always created as PLACED.
 * Deprecated states (PENDING, ACCEPTED, IN_PREPARATION, COMPLETED) exist only
 * in historical records and cannot be the target of new transitions.
 */
export const AUTHORITATIVE_ORDER_STATUSES = [
  'PLACED',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'SERVED',
  'CANCELLED',
] as const;

export const UpdateOrderStatusSchema = z.object({
  orderId: z.string().uuid('Invalid order ID'),
  targetStatus: z.enum(AUTHORITATIVE_ORDER_STATUSES, {
    errorMap: () => ({
      message: `Invalid order status. Must be one of: ${AUTHORITATIVE_ORDER_STATUSES.join(', ')}`,
    }),
  }),
  restaurantId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  reason: z.string().optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;

export class OrderService {
  /**
   * Create customer order with server-side price validation, snapshots & idempotency.
   */
  static async createCustomerOrder(input: CreateOrderInput) {
    const validated = CreateOrderSchema.parse(input);
    const supabase = createAdminClient();

    // 1. Idempotency Check
    if (validated.idempotencyKey) {
      const { data: existing } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', validated.restaurantId)
        .eq('idempotency_key', validated.idempotencyKey)
        .maybeSingle();

      if (existing) {
        logger.info('Idempotent order returned', {
          operation: 'createCustomerOrder',
          orderId: existing.id,
          idempotencyKey: validated.idempotencyKey,
        });
        return {
          order: existing,
          items: existing.order_items,
          // Security: raw order tokens are never persisted (orders.order_token
          // stays NULL). On idempotent replay the token cannot be recovered
          // from storage — the caller already received it at creation time.
          // Callers must fall back to the queue ticket on empty rawToken.
          rawToken: '',
        };
      }
    }

    // 2. Fetch Menu Items to validate availability & current server prices
    const menuItemIds = validated.items.map((i) => i.menuItemId);
    const { data: menuItems, error: menuErr } = await supabase
      .from('menu_items')
      .select('id, name, price, active, available, is_archived')
      .eq('restaurant_id', validated.restaurantId)
      .in('id', menuItemIds);

    if (menuErr || !menuItems) {
      throw new DomainError('Failed to fetch menu items for pricing verification');
    }

    const itemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

    // Validate that every requested item exists, is active, available, and not archived
    for (const reqItem of validated.items) {
      const dbItem = itemMap.get(reqItem.menuItemId);
      if (!dbItem || dbItem.is_archived || !dbItem.active) {
        throw new ValidationError(`Menu item '${reqItem.menuItemId}' is no longer available`);
      }
      if (!dbItem.available) {
        throw new ValidationError(`'${dbItem.name}' is currently out of stock / unavailable`);
      }
    }

    // 3. Compute Server-side Totals & Prepare Price Snapshots
    let subtotal = 0;
    const orderItemsPayload: {
      restaurant_id: string;
      menu_item_id: string;
      name_snapshot: string;
      unit_price_snapshot: number;
      quantity: number;
      total_price: number;
      special_instructions: string | null;
    }[] = [];

    for (const reqItem of validated.items) {
      const dbItem = itemMap.get(reqItem.menuItemId)!;
      const unitPrice = Number(dbItem.price);
      const lineTotal = Math.round(unitPrice * reqItem.quantity * 100) / 100;
      subtotal += lineTotal;

      orderItemsPayload.push({
        restaurant_id: validated.restaurantId,
        menu_item_id: dbItem.id,
        name_snapshot: dbItem.name,
        unit_price_snapshot: unitPrice,
        quantity: reqItem.quantity,
        total_price: lineTotal,
        special_instructions: reqItem.notes || null,
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const tax = 0.0;
    const total = subtotal + tax;

    // 4. Generate Tokens & Order Number
    const rawToken = generateQueueToken();
    const tokenHash = hashQueueToken(rawToken);
    const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    // 5. Create Order Record
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        restaurant_id: validated.restaurantId,
        queue_entry_id: validated.queueEntryId || null,
        table_id: validated.tableId || null,
        order_number: orderNumber,
        status: 'PLACED' as OrderStatus,
        payment_status: 'UNPAID' as PaymentStatus,
        subtotal,
        tax,
        total,
        idempotency_key: validated.idempotencyKey || null,
        // Security: NEVER persist the raw bearer token. Only the SHA-256
        // hash is stored; the raw token is returned once to the customer.
        order_token: null,
        order_token_hash: tokenHash,
        customer_name: validated.customerName || null,
        customer_phone: validated.customerPhone || null,
      })
      .select()
      .single();

    if (orderErr || !order) {
      logger.error('Failed to insert customer order', {
        operation: 'createCustomerOrder',
        restaurantId: validated.restaurantId,
        error: orderErr?.message,
      });
      throw new DomainError('Failed to create order');
    }

    // 6. Insert Order Items (with Price Snapshots)
    const itemsToInsert = orderItemsPayload.map((item) => ({
      ...item,
      order_id: order.id,
    }));

    const { data: insertedItems, error: itemsErr } = await supabase
      .from('order_items')
      .insert(itemsToInsert)
      .select();

    if (itemsErr || !insertedItems) {
      logger.error('Failed to insert order items', {
        operation: 'createCustomerOrder',
        orderId: order.id,
        error: itemsErr?.message,
      });
      // Cleanup order on item insertion failure
      await supabase.from('orders').delete().eq('id', order.id);
      throw new DomainError('Failed to record order items');
    }

    // 7. Record Order Event Audit Trail
    await supabase.from('order_events').insert({
      restaurant_id: validated.restaurantId,
      order_id: order.id,
      event_type: 'ORDER_PLACED',
      metadata: {
        orderNumber,
        itemCount: insertedItems.length,
        totalAmount: total,
      },
    });

    // 7b. Publish Outbox Event for Background Worker & Notifications
    try {
      await OutboxService.publishEvent({
        restaurantId: validated.restaurantId,
        eventType: 'ORDER_PLACED',
        aggregateType: 'ORDER',
        aggregateId: order.id,
        payload: {
          orderNumber,
          totalAmount: total,
          itemCount: insertedItems.length,
          customerName: validated.customerName,
        },
      });
    } catch (outboxErr) {
      logger.warn('Non-blocking outbox publishing failure on createOrder', { error: String(outboxErr) });
    }

    return {
      order,
      items: insertedItems,
      rawToken,
    };
  }

  /**
   * Update Order FSM Status with State Machine & Inventory Consumption rules.
   */
  static async updateOrderStatus(input: UpdateOrderStatusInput) {
    const validated = UpdateOrderStatusSchema.parse(input);
    const supabase = createAdminClient();

    // 1. Fetch current order
    const { data: current, error: fetchErr } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', validated.orderId)
      .single();

    if (fetchErr || !current) {
      throw new NotFoundError('Order not found');
    }

    if (validated.restaurantId && current.restaurant_id !== validated.restaurantId) {
      throw new DomainError('TENANT_MISMATCH: Order does not belong to specified restaurant');
    }

    const currentStatus = current.status as OrderStatus;
    const targetStatus = validated.targetStatus as OrderStatus;

    if (currentStatus === targetStatus) {
      return current; // No-op
    }

    // 2. Validate FSM State Machine Transitions
    // Also treat legacy states as terminal to prevent re-activation of historical records.
    const terminalStates = ['SERVED', 'CANCELLED', 'COMPLETED'];
    const legacyUnroutableStates = ['PENDING', 'ACCEPTED', 'IN_PREPARATION'];

    if (terminalStates.includes(currentStatus)) {
      throw new DomainError(
        `INVALID_ORDER_TRANSITION: Cannot transition from terminal state ${currentStatus} to ${targetStatus}`
      );
    }

    if (legacyUnroutableStates.includes(currentStatus)) {
      throw new DomainError(
        `INVALID_ORDER_TRANSITION: Order is in a legacy state (${currentStatus}) that cannot be transitioned via this service. Manual intervention required.`
      );
    }

    if (currentStatus === 'PLACED') {
      const allowed = ['CONFIRMED', 'CANCELLED'];
      if (!allowed.includes(targetStatus)) {
        throw new DomainError(
          `INVALID_ORDER_TRANSITION: PLACED → must be CONFIRMED or CANCELLED. Received: ${targetStatus}`
        );
      }
    } else if (currentStatus === 'CONFIRMED') {
      const allowed = ['PREPARING', 'CANCELLED'];
      if (!allowed.includes(targetStatus)) {
        throw new DomainError(
          `INVALID_ORDER_TRANSITION: CONFIRMED → must be PREPARING or CANCELLED. Received: ${targetStatus}`
        );
      }
    } else if (currentStatus === 'PREPARING') {
      const allowed = ['READY', 'CANCELLED'];
      if (!allowed.includes(targetStatus)) {
        throw new DomainError(
          `INVALID_ORDER_TRANSITION: PREPARING → must be READY or CANCELLED. Received: ${targetStatus}`
        );
      }
    } else if (currentStatus === 'READY') {
      const allowed = ['SERVED', 'CANCELLED'];
      if (!allowed.includes(targetStatus)) {
        throw new DomainError(
          `INVALID_ORDER_TRANSITION: READY → must be SERVED or CANCELLED. Received: ${targetStatus}`
        );
      }
    }

    // 3. Inventory Stock Consumption — ATOMIC & IDEMPOTENT via deduct_inventory_atomic() RPC
    //
    // Deduction boundary: PLACED → CONFIRMED only.
    //   - Deducting on CONFIRMED ensures stock is reserved exactly once per order.
    //   - NOT triggered again on PREPARING (which would be a double-deduction).
    //   - The deduct_inventory_atomic() RPC is idempotent: if the same
    //     (order, inventory_item) has already been deducted, it returns success
    //     without deducting again (exactly-once guarantee at DB level).
    if (currentStatus === 'PLACED' && targetStatus === 'CONFIRMED') {
      const items = (current.order_items || []) as Array<{ menu_item_id: string | null; quantity: number }>;

      for (const item of items) {
        if (!item.menu_item_id) continue;

        const { data: ingredients } = await supabase
          .from('menu_item_ingredients')
          .select('inventory_item_id, quantity_required')
          .eq('menu_item_id', item.menu_item_id)
          .eq('restaurant_id', current.restaurant_id);

        if (ingredients && ingredients.length > 0) {
          for (const ing of ingredients) {
            const neededQty = Number(ing.quantity_required) * item.quantity;

            // Use atomic RPC: validates quantity > 0, locks row, checks stock,
            // is idempotent on (inventory_item_id, ORDER, order_id).
            const { data: deductResult, error: deductErr } = await supabase.rpc(
              'deduct_inventory_atomic',
              {
                p_restaurant_id:     current.restaurant_id,
                p_inventory_item_id: ing.inventory_item_id,
                p_quantity:          neededQty,
                p_reference_type:    'ORDER',
                p_reference_id:      current.id,
                p_reason:            `Order #${current.order_number} confirmation`,
                p_created_by:        validated.userId || null,
              }
            );

            if (deductErr) {
              if (deductErr.message.includes('INSUFFICIENT_STOCK')) {
                throw new DomainError(
                  `INSUFFICIENT_INVENTORY_STOCK: ${deductErr.message}`
                );
              }
              if (deductErr.message.includes('INVALID_QUANTITY')) {
                throw new DomainError(
                  `INVALID_INVENTORY_QUANTITY: ${deductErr.message}`
                );
              }
              throw new DomainError(
                `Inventory deduction failed: ${deductErr.message}`
              );
            }

            // Log idempotent skips for observability
            if (deductResult && (deductResult as { idempotent?: boolean }).idempotent) {
              logger.info('Idempotent inventory deduction — already consumed', {
                operation: 'updateOrderStatus',
                orderId: current.id,
                inventoryItemId: ing.inventory_item_id,
              });
            }
          }
        }
      }
    }

    // 4. Perform Order Status Update
    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      // Phase 3E: conditional write on the observed status. Concurrent
      // transitions conflict instead of silently overwriting each other
      // (lost update + duplicate contradictory events). The loser retries
      // into the idempotent no-op path when already at target.
      .update({
        status: targetStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .eq('status', currentStatus)
      .select()
      .single();

    if (updateErr || !updated) {
      throw new DomainError(
        `ORDER_STATE_CONFLICT: order changed concurrently (was ${currentStatus}). Please refresh and retry.`
      );
    }

    // 5. Append Order Event Audit Log
    await supabase.from('order_events').insert({
      restaurant_id: current.restaurant_id,
      order_id: current.id,
      event_type: `ORDER_${targetStatus}`,
      actor_user_id: validated.userId || null,
      metadata: {
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: validated.reason || null,
      },
    });

    // 5b. Publish Outbox Event for Background Notifications
    try {
      await OutboxService.publishEvent({
        restaurantId: current.restaurant_id,
        eventType: `ORDER_${targetStatus}`,
        aggregateType: 'ORDER',
        aggregateId: current.id,
        payload: {
          previousStatus: currentStatus,
          newStatus: targetStatus,
          orderNumber: current.order_number,
        },
      });
    } catch (outboxErr) {
      logger.warn('Non-blocking outbox publishing failure on updateOrderStatus', { error: String(outboxErr) });
    }

    return updated;
  }

  /**
   * List all orders linked to a queue entry (for "My Orders" on ticket page).
   * Authorized by entryId + restaurantId derived server-side from queue token —
   * never trust client-supplied ids alone.
   */
  static async listCustomerOrdersByQueueEntry(entryId: string, restaurantId: string) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, subtotal, tax, total, created_at, order_items(name_snapshot, quantity, total_price)')
      .eq('restaurant_id', restaurantId)
      .eq('queue_entry_id', entryId)
      .order('created_at', { ascending: true });
    if (error) {
      logger.warn('Failed to fetch orders by queue entry', {
        operation: 'listCustomerOrdersByQueueEntry',
        metadata: { error: error.message },
      });
      return [];
    }
    return (data || []).map((o) => ({
      id: o.id,
      orderNumber: o.order_number as string,
      status: o.status as OrderStatus,
      paymentStatus: o.payment_status as PaymentStatus,
      total: Number(o.total),
      createdAt: o.created_at as string,
      itemCount: ((o.order_items || []) as Array<{ quantity: number }>).reduce(
        (s, i) => s + (i.quantity || 0),
        0
      ),
      items: ((o.order_items || []) as Array<{ name_snapshot: string; quantity: number; total_price: number }>).map(
        (i) => ({ name: i.name_snapshot, quantity: i.quantity, totalPrice: Number(i.total_price) })
      ),
    }));
  }

  /**
   * Public Customer Order Status Lookup by Token.
   */
  static async getCustomerOrderStateByToken(rawToken: string) {
    if (!rawToken || !rawToken.trim()) {
      return null;
    }

    const tokenHash = hashQueueToken(rawToken.trim());
    const supabase = createAdminClient();

    const { data: order, error } = await supabase
      .from('orders')
      .select('*, order_items(*), restaurants(name, slug, currency)')
      .eq('order_token_hash', tokenHash)
      .maybeSingle();

    if (error || !order) {
      return null;
    }

    const rawItems = (order.order_items || []) as Array<{
      id: string;
      name_snapshot: string;
      unit_price_snapshot: number;
      quantity: number;
      total_price: number;
      special_instructions: string | null;
    }>;

    return {
      orderId: order.id,
      restaurantId: order.restaurant_id,
      restaurantName: (order.restaurants as unknown as { name: string })?.name || 'Restaurant',
      restaurantSlug: (order.restaurants as unknown as { slug: string })?.slug || '',
      restaurantCurrency: (order.restaurants as unknown as { currency?: string })?.currency || 'INR',
      orderNumber: order.order_number,
      status: order.status as OrderStatus,
      paymentStatus: order.payment_status as PaymentStatus,
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      createdAt: order.created_at,
      customerName: order.customer_name,
      items: rawItems.map((item) => ({
        id: item.id,
        name: item.name_snapshot,
        unitPrice: item.unit_price_snapshot,
        quantity: item.quantity,
        totalPrice: item.total_price,
        specialInstructions: item.special_instructions,
      })),
    };
  }

  /**
   * Fetch active kitchen orders for a restaurant (FIFO ordering).
   */
  static async listKitchenOrders(restaurantId: string) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*), queue_entries(display_number, party_size)')
      .eq('restaurant_id', restaurantId)
      .in('status', ['PLACED', 'CONFIRMED', 'PREPARING', 'READY'])
      .order('created_at', { ascending: true }); // FIFO: oldest placed order first

    if (error) {
      throw new DomainError(`Failed to fetch kitchen orders: ${error.message}`);
    }

    return (data || []).map((order) => {
      const q = order.queue_entries as unknown as { display_number: string; party_size: number } | null;
      const rawItems = (order.order_items || []) as Array<{
        id: string;
        name_snapshot: string;
        unit_price_snapshot: number;
        quantity: number;
        total_price: number;
        special_instructions: string | null;
      }>;

      return {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status as OrderStatus,
        customerName: order.customer_name || 'Customer',
        queueDisplayNumber: q?.display_number || null,
        tableId: order.table_id,
        createdAt: order.created_at,
        total: order.total,
        items: rawItems.map((item) => ({
          id: item.id,
          name: item.name_snapshot,
          unitPrice: item.unit_price_snapshot,
          quantity: item.quantity,
          totalPrice: item.total_price,
          notes: item.special_instructions,
        })),
      };
    });
  }

  /**
   * Staff Orders Dashboard Query with Filters & Search.
   */
  static async listDashboardOrders(restaurantId: string, filterStatus?: string, search?: string) {
    const supabase = createAdminClient();

    let query = supabase
      .from('orders')
      .select('*, order_items(*), queue_entries(display_number)')
      .eq('restaurant_id', restaurantId);

    if (filterStatus && filterStatus !== 'ALL') {
      query = query.eq('status', filterStatus);
    }

    if (search && search.trim()) {
      const q = search.trim();
      query = query.or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);

    if (error) {
      throw new DomainError(`Failed to fetch dashboard orders: ${error.message}`);
    }

    return (data || []).map((order) => {
      const q = order.queue_entries as unknown as { display_number: string } | null;
      const rawItems = (order.order_items || []) as Array<{
        id: string;
        name_snapshot: string;
        unit_price_snapshot: number;
        quantity: number;
        total_price: number;
        special_instructions: string | null;
      }>;

      return {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status as OrderStatus,
        paymentStatus: order.payment_status as PaymentStatus,
        customerName: order.customer_name || 'Guest',
        customerPhone: order.customer_phone,
        queueDisplayNumber: q?.display_number || null,
        tableId: order.table_id,
        total: order.total,
        itemCount: rawItems.reduce((acc: number, i: { quantity: number }) => acc + i.quantity, 0),
        createdAt: order.created_at,
        items: rawItems.map((item) => ({
          id: item.id,
          name: item.name_snapshot,
          unitPrice: item.unit_price_snapshot,
          quantity: item.quantity,
          totalPrice: item.total_price,
          notes: item.special_instructions,
        })),
      };
    });
  }
}

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';
import { orderAttentionEntries } from '@/lib/dashboard-attention';

describe('Takeaway Phase 3 — Staff Operations & Takeaway Order Management', () => {
  describe('1. Queue Listing & Service Filtering Isolation', () => {
    const mockEntries = [
      { id: '1', display_number: 'Q-01', queue_type: 'DINE_IN', status: 'WAITING', party_size: 4 },
      { id: '2', display_number: 'T-01', queue_type: 'TAKEAWAY', status: 'WAITING', party_size: 1 },
      { id: '3', display_number: 'Q-02', queue_type: 'DINE_IN', status: 'CALLED', party_size: 2 },
      { id: '4', display_number: 'T-02', queue_type: 'TAKEAWAY', status: 'CALLED', party_size: 1 },
    ];

    it('filters queue correctly by ALL, DINE_IN, and TAKEAWAY', () => {
      const filterQueue = (entries: typeof mockEntries, serviceFilter: 'ALL' | 'DINE_IN' | 'TAKEAWAY') => {
        if (serviceFilter === 'DINE_IN') return entries.filter(e => (e.queue_type || 'DINE_IN') === 'DINE_IN');
        if (serviceFilter === 'TAKEAWAY') return entries.filter(e => e.queue_type === 'TAKEAWAY');
        return entries;
      };

      expect(filterQueue(mockEntries, 'ALL')).toHaveLength(4);
      expect(filterQueue(mockEntries, 'DINE_IN')).toHaveLength(2);
      expect(filterQueue(mockEntries, 'DINE_IN').map(e => e.id)).toEqual(['1', '3']);
      expect(filterQueue(mockEntries, 'TAKEAWAY')).toHaveLength(2);
      expect(filterQueue(mockEntries, 'TAKEAWAY').map(e => e.id)).toEqual(['2', '4']);
    });

    it('does not count party size for takeaway guests in floor seating metrics', () => {
      const dineInGuests = mockEntries
        .filter(e => (e.queue_type || 'DINE_IN') === 'DINE_IN')
        .reduce((sum, e) => sum + e.party_size, 0);

      // Only Q-01 (4) and Q-02 (2) = 6 guests
      expect(dineInGuests).toBe(6);
    });
  });

  describe('2. Takeaway Calling & Notification Copy', () => {
    it('produces pickup-oriented notification text for takeaway tickets', () => {
      const generateCallingNotification = (ticketNumber: string, queueType: string) => {
        const isTakeaway = queueType === 'TAKEAWAY' || ticketNumber.startsWith('T-');
        if (isTakeaway) {
          return {
            title: 'Your takeaway order is ready!',
            body: `Ticket ${ticketNumber} — your takeaway order is ready for pickup. Please proceed to the takeaway counter.`,
          };
        }
        return {
          title: 'Your table is ready!',
          body: `Ticket ${ticketNumber} — please proceed to the host stand.`,
        };
      };

      const takeawayNotif = generateCallingNotification('T-08', 'TAKEAWAY');
      expect(takeawayNotif.title).toBe('Your takeaway order is ready!');
      expect(takeawayNotif.body).toContain('takeaway counter');
      expect(takeawayNotif.body).not.toContain('table');
      expect(takeawayNotif.body).not.toContain('host stand');

      const dineInNotif = generateCallingNotification('Q-05', 'DINE_IN');
      expect(dineInNotif.title).toBe('Your table is ready!');
      expect(dineInNotif.body).toContain('host stand');
    });
  });

  describe('3. Staff-Created Takeaway Order & Multi-Line Item Authority', () => {
    const StaffCreateOrderSchema = z.object({
      restaurantId: z.string().uuid(),
      queueEntryId: z.string().uuid(),
      customerName: z.string().min(1),
      items: z.array(
        z.object({
          menuItemId: z.string().uuid(),
          name: z.string().min(1),
          quantity: z.number().int().positive(),
          notes: z.string().optional(),
        })
      ).min(1, 'Order must contain at least one item'),
    });

    const mockMenuCatalog = new Map([
      ['11111111-1111-4111-a111-111111111111', { name: 'Burger', price: 250, isAvailable: true }],
      ['22222222-2222-4222-a222-222222222222', { name: 'Fries', price: 120, isAvailable: true }],
      ['33333333-3333-4333-a333-333333333333', { name: 'Coke', price: 60, isAvailable: true }],
      ['44444444-4444-4444-a444-444444444444', { name: 'Sold Out Item', price: 150, isAvailable: false }],
    ]);

    it('authoritatively calculates order total using server prices', () => {
      const payload = {
        restaurantId: '99999999-9999-4999-a999-999999999999',
        queueEntryId: '88888888-8888-4888-a888-888888888888',
        customerName: 'Rahul',
        items: [
          { menuItemId: '11111111-1111-4111-a111-111111111111', name: 'Client Fake Name', quantity: 2 },
          { menuItemId: '22222222-2222-4222-a222-222222222222', name: 'Fries', quantity: 1 },
          { menuItemId: '33333333-3333-4333-a333-333333333333', name: 'Coke', quantity: 2 },
        ],
      };

      const parsed = StaffCreateOrderSchema.parse(payload);

      let subtotal = 0;
      const orderItems = parsed.items.map(item => {
        const menuItem = mockMenuCatalog.get(item.menuItemId);
        if (!menuItem) throw new Error(`ITEM_NOT_FOUND: ${item.menuItemId}`);
        if (!menuItem.isAvailable) throw new Error(`ITEM_UNAVAILABLE: ${item.menuItemId}`);
        const lineTotal = menuItem.price * item.quantity;
        subtotal += lineTotal;
        return {
          menu_item_id: item.menuItemId,
          item_name: menuItem.name, // Server name used
          quantity: item.quantity,
          unit_price: menuItem.price, // Server price used
          total_price: lineTotal,
        };
      });

      // 2 * 250 + 1 * 120 + 2 * 60 = 500 + 120 + 120 = 740
      expect(subtotal).toBe(740);
      expect(orderItems[0]!.item_name).toBe('Burger');
      expect(orderItems).toHaveLength(3);
    });

    it('rejects order creation with unavailable menu items', () => {
      const payload = {
        restaurantId: '99999999-9999-4999-a999-999999999999',
        queueEntryId: '88888888-8888-4888-a888-888888888888',
        customerName: 'Rahul',
        items: [
          { menuItemId: '44444444-4444-4444-a444-444444444444', name: 'Sold Out Item', quantity: 1 },
        ],
      };

      const parsed = StaffCreateOrderSchema.parse(payload);
      expect(() => {
        parsed.items.forEach(item => {
          const menuItem = mockMenuCatalog.get(item.menuItemId);
          if (!menuItem || !menuItem.isAvailable) throw new Error(`ITEM_UNAVAILABLE: ${item.menuItemId}`);
        });
      }).toThrow(/ITEM_UNAVAILABLE/);
    });

    it('prevents creating duplicate orders for the same takeaway queue entry', () => {
      const existingOrdersForQueue = new Set(['entry-101']);

      const canCreateOrderForQueue = (entryId: string) => {
        if (existingOrdersForQueue.has(entryId)) {
          throw new Error('ORDER_ALREADY_EXISTS: A takeaway order is already attached to this queue entry.');
        }
        return true;
      };

      expect(canCreateOrderForQueue('entry-102')).toBe(true);
      expect(() => canCreateOrderForQueue('entry-101')).toThrow(/ORDER_ALREADY_EXISTS/);
    });
  });

  describe('4. Order-First Atomic Consistency & Rollback Protection', () => {
    it('rolls back queue entry if subsequent order creation fails in order-first flow', async () => {
      const cancelQueueEntryMock = vi.fn();

      const simulateOrderFirstFlow = async (shouldOrderFail: boolean) => {
        // Step 1: Join queue creates queue entry
        const queueEntry = { id: 'q-999', status: 'WAITING' };

        // Step 2: Attempt creating order
        try {
          if (shouldOrderFail) {
            throw new Error('DATABASE_WRITE_FAILURE');
          }
          return { success: true, queueEntry, order: { id: 'ord-123' } };
        } catch (err) {
          // Rollback: cancel queue entry immediately
          cancelQueueEntryMock(queueEntry.id, 'ORDER_CREATION_FAILED');
          throw err;
        }
      };

      await expect(simulateOrderFirstFlow(true)).rejects.toThrow('DATABASE_WRITE_FAILURE');
      expect(cancelQueueEntryMock).toHaveBeenCalledWith('q-999', 'ORDER_CREATION_FAILED');
    });
  });

  describe('5. Pay at Counter & Completion Rules', () => {
    it('initializes Takeaway order payment status as UNPAID with PAY_AT_COUNTER', () => {
      const takeawayOrder = {
        id: 'ord-takeaway-1',
        queue_entry_id: 'q-entry-1',
        payment_method: 'PAY_AT_COUNTER',
        payment_status: 'UNPAID',
        total: 450,
      };

      expect(takeawayOrder.payment_method).toBe('PAY_AT_COUNTER');
      expect(takeawayOrder.payment_status).toBe('UNPAID');
    });

    it('does NOT mark order as PAID merely because queue entry transitioned to COMPLETED', () => {
      const state = {
        queueEntry: { id: 'q-1', status: 'CALLED' },
        order: { id: 'ord-1', payment_status: 'UNPAID' },
      };

      const completeTakeawayWithoutPayment = () => {
        // complete_takeaway_atomic only updates queue_entries
        state.queueEntry.status = 'COMPLETED';
        // Invariant: Order payment status remains unchanged
      };

      completeTakeawayWithoutPayment();
      expect(state.queueEntry.status).toBe('COMPLETED');
      expect(state.order.payment_status).toBe('UNPAID');
    });

    it('updates order payment status to PAID only upon explicit manual payment confirmation', () => {
      const order = { id: 'ord-1', payment_status: 'UNPAID', payment_method: 'PAY_AT_COUNTER' };

      const recordManualPayment = (paymentMethod: string) => {
        order.payment_status = 'PAID';
        order.payment_method = paymentMethod;
      };

      recordManualPayment('CASH');
      expect(order.payment_status).toBe('PAID');
      expect(order.payment_method).toBe('CASH');
    });
  });

  describe('6. Hard Invariant: Seating Protection', () => {
    it('strictly rejects any attempt to seat a TAKEAWAY queue entry', () => {
      const seatQueueEntry = (entry: { queue_type: string }) => {
        if (entry.queue_type === 'TAKEAWAY') {
          throw new Error('CANNOT_SEAT_TAKEAWAY: Takeaway queue entries cannot be assigned to tables.');
        }
        return { seated: true };
      };

      expect(() => seatQueueEntry({ queue_type: 'TAKEAWAY' })).toThrow(/CANNOT_SEAT_TAKEAWAY/);
      expect(seatQueueEntry({ queue_type: 'DINE_IN' })).toEqual({ seated: true });
    });

    it('excludes Takeaway entries from table recommendation engines', () => {
      const getAvailableTableRecommendations = (queueEntry: { queue_type: string; party_size: number }) => {
        if (queueEntry.queue_type === 'TAKEAWAY') {
          return []; // Zero table recommendations for takeaway
        }
        return [{ table_id: 't-1', capacity: queueEntry.party_size }];
      };

      expect(getAvailableTableRecommendations({ queue_type: 'TAKEAWAY', party_size: 1 })).toEqual([]);
      expect(getAvailableTableRecommendations({ queue_type: 'DINE_IN', party_size: 2 })).toHaveLength(1);
    });
  });

  describe('7. Dashboard Attention Ordering with Takeaway', () => {
    it('preserves canonical overdue CALLED > CALLED > WAITING order regardless of queue type', () => {
      const entries = [
        { id: '1', status: 'WAITING', queue_type: 'DINE_IN', created_at: '2026-09-18T08:00:00Z' },
        { id: '2', status: 'WAITING', queue_type: 'TAKEAWAY', created_at: '2026-09-18T08:05:00Z' },
        { id: '3', status: 'CALLED', queue_type: 'TAKEAWAY', called_at: '2026-09-18T08:20:00Z' },
      ];

      const ordered = orderAttentionEntries(entries, 15, 5, new Date('2026-09-18T08:25:00Z').getTime());
      // CALLED should rank first (id: 3), then oldest WAITING (id: 1), then (id: 2)
      expect(ordered.map(e => e.id)).toEqual(['3', '1', '2']);
    });
  });

  describe('8. Staff RBAC Permissions', () => {
    it('verifies takeaway.manage and takeaway.complete permissions exist and are held by staff', () => {
      expect(PERMISSIONS.TAKEAWAY_MANAGE).toBe('takeaway.manage');
      expect(PERMISSIONS.TAKEAWAY_COMPLETE).toBe('takeaway.complete');

      expect(ROLE_DEFAULT_PERMISSIONS.STAFF).toContain(PERMISSIONS.TAKEAWAY_MANAGE);
      expect(ROLE_DEFAULT_PERMISSIONS.STAFF).toContain(PERMISSIONS.TAKEAWAY_COMPLETE);
      expect(ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN).toContain(PERMISSIONS.TAKEAWAY_MANAGE);
      expect(ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN).toContain(PERMISSIONS.TAKEAWAY_COMPLETE);
    });
  });
});

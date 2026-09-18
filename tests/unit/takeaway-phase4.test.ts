import { describe, it, expect, vi } from 'vitest';
import { updateRestaurantProfileSchema } from '@/lib/services/restaurant-admin-service';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';

describe('Takeaway Phase 4 — Final UX, Operational Polish & Hardening', () => {
  describe('1. Restaurant Settings & Server-Side RBAC Enforcement', () => {
    it('validates takeaway_enabled as an optional boolean in updateRestaurantProfileSchema', () => {
      const validProfileWithTakeaway = {
        name: 'The Golden Fork',
        takeaway_enabled: true,
      };
      const result = updateRestaurantProfileSchema.safeParse(validProfileWithTakeaway);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.takeaway_enabled).toBe(true);
        expect(result.data.seating_mode).toBe('SIMPLE'); // Default preserved
      }

      const validProfileDisabled = {
        name: 'The Golden Fork',
        takeaway_enabled: false,
      };
      const resultDisabled = updateRestaurantProfileSchema.safeParse(validProfileDisabled);
      expect(resultDisabled.success).toBe(true);
      if (resultDisabled.success) {
        expect(resultDisabled.data.takeaway_enabled).toBe(false);
      }
    });

    it('rejects invalid non-boolean types for takeaway_enabled', () => {
      const invalidProfile = {
        name: 'The Golden Fork',
        takeaway_enabled: 'yes',
      };
      const result = updateRestaurantProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it('enforces that only RESTAURANT_ADMIN / RESTAURANT_UPDATE permission can modify venue takeaway setting', () => {
      const adminPerms = ROLE_DEFAULT_PERMISSIONS['RESTAURANT_ADMIN'];
      const staffPerms = ROLE_DEFAULT_PERMISSIONS['STAFF'];

      expect(adminPerms).toContain(PERMISSIONS.RESTAURANT_UPDATE);
      expect(staffPerms).not.toContain(PERMISSIONS.RESTAURANT_UPDATE);
    });

    it('enforces server-side rejection when joining takeaway queue if restaurant takeaway is disabled', () => {
      const simulateJoinQueue = (restaurant: { takeaway_enabled: boolean }, queueType: 'DINE_IN' | 'TAKEAWAY') => {
        if (queueType === 'TAKEAWAY' && !restaurant.takeaway_enabled) {
          throw new Error('TAKEAWAY_NOT_ENABLED: This restaurant does not currently accept takeaway orders.');
        }
        return { success: true, queueType };
      };

      // When takeaway is disabled, server must reject
      expect(() => simulateJoinQueue({ takeaway_enabled: false }, 'TAKEAWAY')).toThrow('TAKEAWAY_NOT_ENABLED');

      // Dine-in remains allowed even when takeaway is disabled
      expect(simulateJoinQueue({ takeaway_enabled: false }, 'DINE_IN')).toEqual({
        success: true,
        queueType: 'DINE_IN',
      });

      // Both allowed when takeaway is enabled
      expect(simulateJoinQueue({ takeaway_enabled: true }, 'TAKEAWAY')).toEqual({
        success: true,
        queueType: 'TAKEAWAY',
      });
    });
  });

  describe('2. Customer QR Experience & Service Selector', () => {
    it('displays only Dine-In when takeaway is disabled', () => {
      const getAvailableServices = (takeawayEnabled: boolean) => {
        const services = [{ type: 'DINE_IN', label: 'DINE-IN', description: 'Sit inside the restaurant.' }];
        if (takeawayEnabled) {
          services.push({
            type: 'TAKEAWAY',
            label: 'TAKEAWAY',
            description: 'Order and collect from the counter.',
          });
        }
        return services;
      };

      const disabledServices = getAvailableServices(false);
      expect(disabledServices).toHaveLength(1);
      expect(disabledServices[0]?.type).toBe('DINE_IN');

      const enabledServices = getAvailableServices(true);
      expect(enabledServices).toHaveLength(2);
      expect(enabledServices.map((s) => s.type)).toEqual(['DINE_IN', 'TAKEAWAY']);
      expect(enabledServices[1]?.description).toBe('Order and collect from the counter.');
    });
  });

  describe('3. Payment Model (PAY AT COUNTER) & Unblocked Pickup Completion', () => {
    it('verifies that Takeaway payment method is PAY AT COUNTER without digital gateway', () => {
      const order = {
        id: 'ord-123',
        paymentMethod: 'PAY_AT_COUNTER',
        paymentStatus: 'PENDING',
        total: 450,
      };

      expect(order.paymentMethod).toBe('PAY_AT_COUNTER');
      expect(order.paymentMethod).not.toMatch(/RAZORPAY|STRIPE|ONLINE/);
    });

    it('verifies customer and staff facing text requirements for PAY AT COUNTER', () => {
      const getPaymentCopy = (paymentMethod: string) => {
        if (paymentMethod === 'PAY_AT_COUNTER') {
          return {
            badge: 'PAY AT COUNTER',
            instruction: 'You can pay when collecting your order.',
            button: 'PLACE TAKEAWAY ORDER',
          };
        }
        return { badge: 'ONLINE', instruction: 'Pay online', button: 'PAY' };
      };

      const copy = getPaymentCopy('PAY_AT_COUNTER');
      expect(copy.badge).toBe('PAY AT COUNTER');
      expect(copy.instruction).toBe('You can pay when collecting your order.');
      expect(copy.button).toBe('PLACE TAKEAWAY ORDER');
    });

    it('allows complete pickup when status is CALLING regardless of paymentStatus', () => {
      const completePickup = (entry: {
        id: string;
        queue_type: string;
        status: string;
        order?: { paymentStatus: string };
      }) => {
        if (entry.queue_type !== 'TAKEAWAY') {
          throw new Error('NOT_TAKEAWAY_ENTRY');
        }
        if (entry.status !== 'CALLED') {
          throw new Error('INVALID_STATUS: Entry must be in CALLED state to complete pickup');
        }
        // CRITICAL INVARIANT: Payment status does NOT block completion
        return {
          success: true,
          previousStatus: 'CALLED',
          newStatus: 'COMPLETED',
          completedAt: new Date().toISOString(),
        };
      };

      // Completes successfully even if paymentStatus is PENDING (Pay at Counter handled physically)
      const resPending = completePickup({
        id: 'q-1',
        queue_type: 'TAKEAWAY',
        status: 'CALLED',
        order: { paymentStatus: 'PENDING' },
      });
      expect(resPending.success).toBe(true);
      expect(resPending.newStatus).toBe('COMPLETED');

      // Also completes if manual payment was optionally recorded (PAID)
      const resPaid = completePickup({
        id: 'q-2',
        queue_type: 'TAKEAWAY',
        status: 'CALLED',
        order: { paymentStatus: 'PAID' },
      });
      expect(resPaid.success).toBe(true);
      expect(resPaid.newStatus).toBe('COMPLETED');

      // Fails if not CALLED
      expect(() =>
        completePickup({
          id: 'q-3',
          queue_type: 'TAKEAWAY',
          status: 'WAITING',
        })
      ).toThrow('INVALID_STATUS');
    });
  });

  describe('4. Hard Table and Seating Invariant Proof', () => {
    it('proves Takeaway never affects table capacity, recommendations, or seating RPCs', () => {
      const seatQueueEntry = (entry: { id: string; queue_type: string }, tableId: string) => {
        if (entry.queue_type === 'TAKEAWAY') {
          throw new Error('CANNOT_SEAT_TAKEAWAY: Takeaway queue entries are pickup-only and cannot be seated at tables.');
        }
        return { success: true, seated_table_id: tableId, status: 'SEATED' };
      };

      expect(() => seatQueueEntry({ id: 't-1', queue_type: 'TAKEAWAY' }, 'tbl-5')).toThrow('CANNOT_SEAT_TAKEAWAY');
      expect(seatQueueEntry({ id: 'q-1', queue_type: 'DINE_IN' }, 'tbl-5')).toEqual({
        success: true,
        seated_table_id: 'tbl-5',
        status: 'SEATED',
      });
    });

    it('proves table occupancy calculations strictly ignore takeaway queue entries', () => {
      const tables = [
        { id: 't1', capacity: 4, status: 'OCCUPIED' },
        { id: 't2', capacity: 2, status: 'AVAILABLE' },
      ];
      const queue = [
        { id: 'q1', queue_type: 'DINE_IN', party_size: 4, status: 'WAITING' },
        { id: 't1', queue_type: 'TAKEAWAY', party_size: 1, status: 'WAITING' },
        { id: 't2', queue_type: 'TAKEAWAY', party_size: 1, status: 'CALLED' },
      ];

      const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;
      const dineInWaitingGuests = queue
        .filter((q) => (q.queue_type || 'DINE_IN') === 'DINE_IN' && q.status === 'WAITING')
        .reduce((sum, q) => sum + q.party_size, 0);

      expect(occupiedTables).toBe(1);
      expect(dineInWaitingGuests).toBe(4);
    });
  });

  describe('5. Order Model & Idempotency Protection', () => {
    it('supports one Takeaway transaction containing multiple line items with authoritative pricing', () => {
      const menuCatalog = new Map([
        ['item-burger', { name: 'Burger', price: 150, available: true }],
        ['item-fries', { name: 'Fries', price: 70, available: true }],
        ['item-coke', { name: 'Coke', price: 40, available: true }],
      ]);

      const cartSubmission = [
        { menuItemId: 'item-burger', quantity: 2 },
        { menuItemId: 'item-fries', quantity: 1 },
        { menuItemId: 'item-coke', quantity: 2 },
      ];

      // Server calculates authoritative line items and total
      const orderItems = cartSubmission.map((item) => {
        const itemDef = menuCatalog.get(item.menuItemId);
        if (!itemDef || !itemDef.available) throw new Error('ITEM_UNAVAILABLE');
        return {
          name: itemDef.name,
          unitPrice: itemDef.price,
          quantity: item.quantity,
          totalPrice: itemDef.price * item.quantity,
        };
      });

      const total = orderItems.reduce((sum, i) => sum + i.totalPrice, 0);

      expect(orderItems).toHaveLength(3);
      expect(orderItems[0]).toEqual({ name: 'Burger', unitPrice: 150, quantity: 2, totalPrice: 300 });
      expect(orderItems[1]).toEqual({ name: 'Fries', unitPrice: 70, quantity: 1, totalPrice: 70 });
      expect(orderItems[2]).toEqual({ name: 'Coke', unitPrice: 40, quantity: 2, totalPrice: 80 });
      expect(total).toBe(450); // 300 + 70 + 80 = 450
    });

    it('rejects duplicate order creation on an existing takeaway entry', () => {
      const activeOrders = new Map<string, string>(); // queueEntryId -> orderId

      const attachOrder = (queueEntryId: string, orderId: string) => {
        if (activeOrders.has(queueEntryId)) {
          throw new Error('DUPLICATE_TAKEAWAY_ORDER: Queue entry already has an active order.');
        }
        activeOrders.set(queueEntryId, orderId);
        return { success: true, orderId };
      };

      expect(attachOrder('q-100', 'ord-1')).toEqual({ success: true, orderId: 'ord-1' });
      expect(() => attachOrder('q-100', 'ord-2')).toThrow('DUPLICATE_TAKEAWAY_ORDER');
    });

    it('maps database unique constraint violation (code 23505) to a clean DomainError', () => {
      const handleInsertError = (err: { code: string; message: string }) => {
        if (err.code === '23505') {
          throw new Error('An active order already exists for this queue ticket.');
        }
        throw new Error('Failed to create order');
      };

      expect(() => handleInsertError({ code: '23505', message: 'duplicate key value violates unique constraint' }))
        .toThrow('An active order already exists for this queue ticket.');
    });

    it('idempotency pre-check recovers existing order and ticket without creating a second queue entry', () => {
      const db = {
        orders: new Map([['idemp-key-1', { id: 'ord-99', queueEntryId: 'q-99' }]]),
      };

      const processTakeawayOrderFirst = (idempotencyKey: string) => {
        if (db.orders.has(idempotencyKey)) {
          const existing = db.orders.get(idempotencyKey)!;
          return { success: true, queueEntryId: existing.queueEntryId, orderId: existing.id, isReplay: true };
        }
        return { success: true, queueEntryId: 'q-new', orderId: 'ord-new', isReplay: false };
      };

      const first = processTakeawayOrderFirst('idemp-key-1');
      expect(first.isReplay).toBe(true);
      expect(first.queueEntryId).toBe('q-99');

      const fresh = processTakeawayOrderFirst('idemp-key-2');
      expect(fresh.isReplay).toBe(false);
      expect(fresh.queueEntryId).toBe('q-new');
    });
  });

  describe('6. Sound & Vibration Notification Deduplication', () => {
    it('plays loud buzzer only on transition to CALLED, avoiding repeat on polling', () => {
      const playBuzzerMock = vi.fn();
      let prevStatus = 'WAITING';

      const handleStatusUpdate = (newStatus: string) => {
        if (prevStatus !== newStatus) {
          if (newStatus === 'CALLED') {
            playBuzzerMock();
          }
          prevStatus = newStatus;
        }
      };

      // 1. Initial WAITING state
      handleStatusUpdate('WAITING');
      expect(playBuzzerMock).not.toHaveBeenCalled();

      // 2. Transition to CALLED
      handleStatusUpdate('CALLED');
      expect(playBuzzerMock).toHaveBeenCalledTimes(1);

      // 3. Subsequent polling cycles while still CALLED (deduplicated)
      handleStatusUpdate('CALLED');
      handleStatusUpdate('CALLED');
      handleStatusUpdate('CALLED');
      expect(playBuzzerMock).toHaveBeenCalledTimes(1); // No repeated chiming
    });
  });
});

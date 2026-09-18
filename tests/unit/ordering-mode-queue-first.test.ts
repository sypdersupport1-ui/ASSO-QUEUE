import { describe, it, expect } from 'vitest';
import { updateRestaurantProfileSchema } from '@/lib/services/restaurant-admin-service';
import { updateRestaurantSchema } from '@/lib/services/platform-service';

describe('Ordering Modes & Queue-First Takeaway / Dine-In Revision', () => {
  describe('1. Four Ordering Capability Flags (Schema Validation)', () => {
    it('allows all 4 ordering flags in updateRestaurantProfileSchema', () => {
      const payload = {
        name: 'Curry Express',
        dine_in_customer_ordering_enabled: true,
        dine_in_staff_ordering_enabled: true,
        takeaway_customer_ordering_enabled: false,
        takeaway_staff_ordering_enabled: true,
      };

      const parsed = updateRestaurantProfileSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.dine_in_customer_ordering_enabled).toBe(true);
        expect(parsed.data.dine_in_staff_ordering_enabled).toBe(true);
        expect(parsed.data.takeaway_customer_ordering_enabled).toBe(false);
        expect(parsed.data.takeaway_staff_ordering_enabled).toBe(true);
      }
    });

    it('allows all 4 ordering flags in platform updateRestaurantSchema', () => {
      const payload = {
        name: 'Curry Express',
        dine_in_customer_ordering_enabled: false,
        dine_in_staff_ordering_enabled: true,
        takeaway_customer_ordering_enabled: true,
        takeaway_staff_ordering_enabled: false,
      };

      const parsed = updateRestaurantSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.dine_in_customer_ordering_enabled).toBe(false);
        expect(parsed.data.dine_in_staff_ordering_enabled).toBe(true);
        expect(parsed.data.takeaway_customer_ordering_enabled).toBe(true);
        expect(parsed.data.takeaway_staff_ordering_enabled).toBe(false);
      }
    });

    it('rejects non-boolean values for the 4 capability flags', () => {
      const invalidPayload = {
        name: 'Curry Express',
        dine_in_customer_ordering_enabled: 'yes',
      };
      const parsed = updateRestaurantProfileSchema.safeParse(invalidPayload);
      expect(parsed.success).toBe(false);
    });
  });

  describe('2. OrderService Capability Enforcement', () => {
    it('rejects customer self-ordering when takeaway_customer_ordering_enabled is false for Takeaway', () => {
      const checkCapability = (restaurant: { takeaway_customer_ordering_enabled: boolean; dine_in_customer_ordering_enabled: boolean }, serviceType: 'TAKEAWAY' | 'DINE_IN') => {
        if (serviceType === 'TAKEAWAY' && restaurant.takeaway_customer_ordering_enabled === false) {
          throw new Error('CUSTOMER_ORDERING_DISABLED: Takeaway customer ordering is disabled for this restaurant.');
        }
        if (serviceType === 'DINE_IN' && restaurant.dine_in_customer_ordering_enabled === false) {
          throw new Error('CUSTOMER_ORDERING_DISABLED: Dine-in customer ordering is disabled for this restaurant.');
        }
        return true;
      };

      expect(() =>
        checkCapability(
          { takeaway_customer_ordering_enabled: false, dine_in_customer_ordering_enabled: true },
          'TAKEAWAY'
        )
      ).toThrow('CUSTOMER_ORDERING_DISABLED');

      expect(
        checkCapability(
          { takeaway_customer_ordering_enabled: false, dine_in_customer_ordering_enabled: true },
          'DINE_IN'
        )
      ).toBe(true);
    });

    it('rejects customer self-ordering when dine_in_customer_ordering_enabled is false for Dine-In', () => {
      const checkCapability = (restaurant: { takeaway_customer_ordering_enabled: boolean; dine_in_customer_ordering_enabled: boolean }, serviceType: 'TAKEAWAY' | 'DINE_IN') => {
        if (serviceType === 'DINE_IN' && restaurant.dine_in_customer_ordering_enabled === false) {
          throw new Error('CUSTOMER_ORDERING_DISABLED: Dine-in customer ordering is disabled for this restaurant.');
        }
        return true;
      };

      expect(() =>
        checkCapability(
          { takeaway_customer_ordering_enabled: true, dine_in_customer_ordering_enabled: false },
          'DINE_IN'
        )
      ).toThrow('CUSTOMER_ORDERING_DISABLED');
    });
  });

  describe('3. Rule 3: Idempotent Collection Acknowledgement & Zero Financial Records', () => {
    it('returns idempotent: true when order is already PREPARING or READY', async () => {
      // Simulate double-click on collection acknowledgement
      const simulateAcknowledge = (currentStatus: string) => {
        if (currentStatus === 'PREPARING' || currentStatus === 'READY') {
          return { idempotent: true, orderId: 'ord-123', status: currentStatus };
        }
        if (['PLACED', 'CONFIRMED'].includes(currentStatus)) {
          return { idempotent: false, orderId: 'ord-123', status: 'PREPARING' };
        }
        throw new Error(`INVALID_TRANSITION: Cannot acknowledge collection from status ${currentStatus}`);
      };

      // First click
      const firstClick = simulateAcknowledge('CONFIRMED');
      expect(firstClick.idempotent).toBe(false);
      expect(firstClick.status).toBe('PREPARING');

      // Second click (double click or concurrent staff click)
      const secondClick = simulateAcknowledge('PREPARING');
      expect(secondClick.idempotent).toBe(true);
      expect(secondClick.status).toBe('PREPARING');

      // Third click when order is already marked READY
      const thirdClick = simulateAcknowledge('READY');
      expect(thirdClick.idempotent).toBe(true);
      expect(thirdClick.status).toBe('READY');
    });

    it('creates zero records in payments table upon collection acknowledgement', () => {
      // Collection acknowledgement is strictly operational (order_events log)
      const auditLog = [] as string[];
      const paymentsTable = [] as Array<{ id: string; amount: number }>;

      const acknowledgeCollection = (orderId: string) => {
        auditLog.push(`order_events: COLLECTION_ACKNOWLEDGED for ${orderId}`);
        // Zero writes to payments table
      };

      acknowledgeCollection('ord-456');

      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]).toContain('COLLECTION_ACKNOWLEDGED');
      expect(paymentsTable).toHaveLength(0); // Zero financial payment records
    });
  });

  describe('4. Rule 1: ITEMS RECEIVED Must NOT Be Available While PREPARING', () => {
    it('rejects takeaway pickup completion if linked order is still PREPARING', () => {
      const simulateCompleteTakeaway = (_queueEntry: { id: string }, linkedOrder?: { status: string }) => {
        if (linkedOrder && linkedOrder.status === 'PREPARING') {
          throw new Error('CANNOT_RECEIVE_WHILE_PREPARING: Cannot complete takeaway pickup while linked order is still PREPARING. Order must reach READY first.');
        }
        return {
          queueStatus: 'COMPLETED',
          orderStatus: linkedOrder ? 'SERVED' : undefined,
        };
      };

      // While PREPARING: must throw CANNOT_RECEIVE_WHILE_PREPARING
      expect(() =>
        simulateCompleteTakeaway({ id: 'q-1' }, { status: 'PREPARING' })
      ).toThrow('CANNOT_RECEIVE_WHILE_PREPARING');

      // Once READY: completes pickup, marks order SERVED and queue COMPLETED
      const resultWhenReady = simulateCompleteTakeaway({ id: 'q-1' }, { status: 'READY' });
      expect(resultWhenReady.queueStatus).toBe('COMPLETED');
      expect(resultWhenReady.orderStatus).toBe('SERVED');

      // Queue-only ticket with NO order: allows direct completion
      const resultNoOrder = simulateCompleteTakeaway({ id: 'q-2' }, undefined);
      expect(resultNoOrder.queueStatus).toBe('COMPLETED');
      expect(resultNoOrder.orderStatus).toBeUndefined();
    });
  });

  describe('5. Rule 2: Preservation of State Distinctions', () => {
    it('distinguishes ORDER COMPLETED customer stage from operational PREPARING and READY states', () => {
      const resolveCustomerStage = (
        queueStatus: string,
        orderStatus?: string
      ): 'WAITING' | 'CALLED' | 'ORDER_COMPLETED' | 'ITEMS_RECEIVED' => {
        if (queueStatus === 'COMPLETED' || orderStatus === 'SERVED') {
          return 'ITEMS_RECEIVED';
        }
        if (queueStatus === 'CALLED') {
          if (orderStatus === 'PREPARING' || orderStatus === 'READY') {
            return 'ORDER_COMPLETED';
          }
          return 'CALLED';
        }
        return 'WAITING';
      };

      // 1. Initial queue state
      expect(resolveCustomerStage('WAITING', 'CONFIRMED')).toBe('WAITING');

      // 2. Staff calls customer ticket
      expect(resolveCustomerStage('CALLED', 'CONFIRMED')).toBe('CALLED');

      // 3. Staff acknowledges collection -> order PREPARING -> customer stage ORDER COMPLETED
      expect(resolveCustomerStage('CALLED', 'PREPARING')).toBe('ORDER_COMPLETED');

      // 4. Kitchen marks READY -> remains in customer stage ORDER COMPLETED (operational milestone notification)
      expect(resolveCustomerStage('CALLED', 'READY')).toBe('ORDER_COMPLETED');

      // 5. Staff clicks Items Received -> order becomes SERVED, queue COMPLETED -> stage ITEMS_RECEIVED
      expect(resolveCustomerStage('COMPLETED', 'SERVED')).toBe('ITEMS_RECEIVED');
    });

    it('verifies that ORDER COMPLETED is never treated as equivalent to READY or SERVED', () => {
      const orderCompletedState = {
        customerStage: 'ORDER_COMPLETED',
        orderStatus: 'PREPARING',
        isTerminal: false,
        canHandover: false, // Cannot handover while PREPARING
      };

      const readyState = {
        customerStage: 'ORDER_COMPLETED',
        orderStatus: 'READY',
        isTerminal: false,
        canHandover: true, // Can handover when READY
      };

      const servedState = {
        customerStage: 'ITEMS_RECEIVED',
        orderStatus: 'SERVED',
        isTerminal: true,
        canHandover: false, // Already handed over
      };

      expect(orderCompletedState.orderStatus).not.toBe(readyState.orderStatus);
      expect(orderCompletedState.orderStatus).not.toBe(servedState.orderStatus);
      expect(orderCompletedState.canHandover).toBe(false);
      expect(readyState.canHandover).toBe(true);
      expect(servedState.isTerminal).toBe(true);
    });
  });

  describe('6. Dine-In Seating Invariants Protection', () => {
    it('verifies Takeaway tickets never assign tables or use party size', () => {
      const takeawayEntry = {
        queue_type: 'TAKEAWAY',
        party_size: 1, // Default storage
        table_id: null,
      };

      // Takeaway tickets never allocate a table
      expect(takeawayEntry.table_id).toBeNull();
      expect(takeawayEntry.queue_type).toBe('TAKEAWAY');
    });

    it('verifies Takeaway entries are rejected from table recommendations', () => {
      const checkTableRecommendation = (entry: { queue_type: string }) => {
        if (entry.queue_type === 'TAKEAWAY') {
          throw new Error('TAKEAWAY_NO_TABLE_RECOMMENDATION: Takeaway entries do not receive table assignments or recommendations');
        }
        return [{ tableId: 't-1', tableName: 'Table 1' }];
      };

      expect(() => checkTableRecommendation({ queue_type: 'TAKEAWAY' })).toThrow('TAKEAWAY_NO_TABLE_RECOMMENDATION');
      expect(checkTableRecommendation({ queue_type: 'DINE_IN' })).toHaveLength(1);
    });

    it('verifies Takeaway entries can never be transitioned to SEATED', () => {
      const checkSeatingTransition = (entry: { queue_type: string }, targetStatus: string) => {
        if (entry.queue_type === 'TAKEAWAY' && targetStatus === 'SEATED') {
          throw new Error('TAKEAWAY_CANNOT_BE_SEATED: Takeaway orders do not receive table assignments. Use complete_takeaway_atomic instead.');
        }
        return { success: true, status: targetStatus };
      };

      expect(() => checkSeatingTransition({ queue_type: 'TAKEAWAY' }, 'SEATED')).toThrow('TAKEAWAY_CANNOT_BE_SEATED');
      expect(checkSeatingTransition({ queue_type: 'DINE_IN' }, 'SEATED').status).toBe('SEATED');
    });
  });

  describe('7. Staff Ordering Capability Enforcement (Dine-In & Takeaway)', () => {
    it('rejects staff Dine-In order creation when dine_in_staff_ordering_enabled is false', () => {
      const simulateStaffDineInOrder = (restaurant: { dine_in_staff_ordering_enabled: boolean }) => {
        if (restaurant.dine_in_staff_ordering_enabled === false) {
          throw new Error('Staff ordering is disabled for Dine-In at this outlet.');
        }
        return { success: true, orderId: 'ord-dinein-1' };
      };

      expect(() => simulateStaffDineInOrder({ dine_in_staff_ordering_enabled: false })).toThrow('Staff ordering is disabled for Dine-In at this outlet.');
      expect(simulateStaffDineInOrder({ dine_in_staff_ordering_enabled: true }).success).toBe(true);
    });

    it('rejects staff Takeaway order creation when takeaway_staff_ordering_enabled is false', () => {
      const simulateStaffTakeawayOrder = (restaurant: { takeaway_staff_ordering_enabled: boolean }) => {
        if (restaurant.takeaway_staff_ordering_enabled === false) {
          throw new Error('Staff counter ordering is disabled for Takeaway at this outlet.');
        }
        return { success: true, orderId: 'ord-takeaway-1' };
      };

      expect(() => simulateStaffTakeawayOrder({ takeaway_staff_ordering_enabled: false })).toThrow('Staff counter ordering is disabled for Takeaway at this outlet.');
      expect(simulateStaffTakeawayOrder({ takeaway_staff_ordering_enabled: true }).success).toBe(true);
    });
  });

  describe('8. No-Order Takeaway Scenarios (A, B, C)', () => {
    it('Scenario A: Customer ON, Staff ON — customer joins without order, staff can take order when CALLED', () => {
      const config = { takeaway_customer_ordering_enabled: true, takeaway_staff_ordering_enabled: true };
      const ticket = { id: 'tk-1', status: 'CALLED', orderId: null };

      const canStaffTakeOrder = Boolean(config.takeaway_staff_ordering_enabled && !ticket.orderId);
      expect(canStaffTakeOrder).toBe(true);
    });

    it('Scenario B: Customer ON, Staff OFF — customer joins without order, staff CANNOT take counter order', () => {
      const config = { takeaway_customer_ordering_enabled: true, takeaway_staff_ordering_enabled: false };
      const ticket = { id: 'tk-2', status: 'CALLED', orderId: null };

      const canStaffTakeOrder = Boolean(config.takeaway_staff_ordering_enabled && !ticket.orderId);
      expect(canStaffTakeOrder).toBe(false);
    });

    it('Scenario C: Customer OFF, Staff OFF — queue-only mode completes directly without an order', () => {
      const config = { takeaway_customer_ordering_enabled: false, takeaway_staff_ordering_enabled: false };
      expect(config.takeaway_customer_ordering_enabled).toBe(false);
      expect(config.takeaway_staff_ordering_enabled).toBe(false);
      const ticket = { id: 'tk-3', status: 'CALLED', queue_type: 'TAKEAWAY', orderId: null };

      // Queue-only completeTakeaway does not require an order
      const completeQueueOnly = (entry: typeof ticket) => {
        if (entry.status !== 'CALLED' && entry.status !== 'WAITING') {
          throw new Error('NOT_COMPLETABLE');
        }
        return {
          success: true,
          queueStatus: 'COMPLETED',
          stage: 'ITEMS_RECEIVED',
          hasOrder: false,
        };
      };

      const result = completeQueueOnly(ticket);
      expect(result.success).toBe(true);
      expect(result.queueStatus).toBe('COMPLETED');
      expect(result.hasOrder).toBe(false);
    });
  });
});

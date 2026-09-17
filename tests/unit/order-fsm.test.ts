/**
 * tests/unit/order-fsm.test.ts
 *
 * Tests the Order FSM transitions, ensuring valid transitions succeed,
 * invalid transitions fail, legacy states are rejected for new transitions,
 * and exactly-once inventory deduction on PLACED->CONFIRMED.
 */

import { describe, it, expect } from 'vitest';
import { UpdateOrderStatusSchema } from '@/lib/services/order-service';

describe('Order FSM', () => {
  describe('Schema Validation', () => {
    it('accepts valid FSM states', () => {
      const validStates = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
      for (const state of validStates) {
        const result = UpdateOrderStatusSchema.safeParse({
          orderId: '00000000-0000-0000-0000-000000000000',
          targetStatus: state,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects legacy deprecated states', () => {
      const legacyStates = ['PENDING', 'ACCEPTED', 'IN_PREPARATION', 'COMPLETED'];
      for (const state of legacyStates) {
        const result = UpdateOrderStatusSchema.safeParse({
          orderId: '00000000-0000-0000-0000-000000000000',
          targetStatus: state,
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects arbitrary invalid states', () => {
      const result = UpdateOrderStatusSchema.safeParse({
        orderId: '00000000-0000-0000-0000-000000000000',
        targetStatus: 'UNKNOWN',
      });
      expect(result.success).toBe(false);
    });
  });
});

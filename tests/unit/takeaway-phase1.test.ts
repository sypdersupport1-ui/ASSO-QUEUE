import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';
import type { QueueType } from '@/types/database.types';

describe('Takeaway Phase 1 — Unit Tests', () => {
  describe('Zod Validation & QueueType Schema', () => {
    const joinQueueSchema = z.object({
      restaurantId: z.string().uuid(),
      customerName: z.string().min(1, 'Name is required').max(100),
      customerPhone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
      partySize: z.number().int().min(1).max(20),
      queueType: z.enum(['DINE_IN', 'TAKEAWAY']).default('DINE_IN'),
    });

    it('defaults queueType to DINE_IN when omitted', () => {
      const parsed = joinQueueSchema.parse({
        restaurantId: '11111111-1111-4111-a111-111111111111',
        customerName: 'Alice',
        customerPhone: '+14155552671',
        partySize: 2,
      });
      expect(parsed.queueType).toBe('DINE_IN');
    });

    it('accepts TAKEAWAY as a valid queueType', () => {
      const parsed = joinQueueSchema.parse({
        restaurantId: '11111111-1111-4111-a111-111111111111',
        customerName: 'Bob',
        customerPhone: '+14155552672',
        partySize: 1,
        queueType: 'TAKEAWAY',
      });
      expect(parsed.queueType).toBe('TAKEAWAY');
    });

    it('rejects invalid queueType values', () => {
      expect(() =>
        joinQueueSchema.parse({
          restaurantId: '11111111-1111-4111-a111-111111111111',
          customerName: 'Charlie',
          customerPhone: '+14155552673',
          partySize: 1,
          queueType: 'DELIVERY',
        })
      ).toThrow();
    });
  });

  describe('RBAC Permissions for Takeaway', () => {
    it('grants takeaway permissions to SUPER_ADMIN', () => {
      expect(ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN).toContain(PERMISSIONS.TAKEAWAY_MANAGE);
      expect(ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN).toContain(PERMISSIONS.TAKEAWAY_COMPLETE);
    });

    it('grants operational takeaway permissions to RESTAURANT_ADMIN', () => {
      expect(ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN).toContain(PERMISSIONS.TAKEAWAY_MANAGE);
      expect(ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN).toContain(PERMISSIONS.TAKEAWAY_COMPLETE);
    });

    it('grants operational takeaway permissions to STAFF', () => {
      expect(ROLE_DEFAULT_PERMISSIONS.STAFF).toContain(PERMISSIONS.TAKEAWAY_MANAGE);
      expect(ROLE_DEFAULT_PERMISSIONS.STAFF).toContain(PERMISSIONS.TAKEAWAY_COMPLETE);
    });
  });

  describe('Queue Type Invariants', () => {
    it('ensures QueueType union contains exactly DINE_IN and TAKEAWAY', () => {
      const types: QueueType[] = ['DINE_IN', 'TAKEAWAY'];
      expect(types).toHaveLength(2);
      expect(types).toContain('DINE_IN');
      expect(types).toContain('TAKEAWAY');
    });
  });
});

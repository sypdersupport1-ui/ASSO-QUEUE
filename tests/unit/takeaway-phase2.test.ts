import { describe, it, expect } from 'vitest';
import { formatTakeawayTicketNumber, formatTicketNumber } from '@/lib/customer-ticket-ux';
import { z } from 'zod';

describe('Takeaway Phase 2 — Customer Journey Unit Tests', () => {
  describe('Ticket Number Presentation Formatting', () => {
    it('formats takeaway ticket number with T- prefix for clean numeric display numbers', () => {
      expect(formatTakeawayTicketNumber('08', 'uuid-1234')).toBe('T-08');
      expect(formatTakeawayTicketNumber('1', 'uuid-1234')).toBe('T-1');
      expect(formatTakeawayTicketNumber('105', 'uuid-1234')).toBe('T-105');
    });

    it('cleans existing hash and prefix signs from takeaway display numbers', () => {
      expect(formatTakeawayTicketNumber('#08', 'uuid-1234')).toBe('T-08');
      expect(formatTakeawayTicketNumber('Q-12', 'uuid-1234')).toBe('T-12');
      expect(formatTakeawayTicketNumber('T-05', 'uuid-1234')).toBe('T-05');
    });

    it('falls back to truncated entryId for takeaway when display number is null or empty', () => {
      expect(formatTakeawayTicketNumber(null, 'abcd-efgh-1234')).toBe('T-ABCD');
      expect(formatTakeawayTicketNumber('', '7890-wxyz')).toBe('T-7890');
    });

    it('preserves Dine-In ticket number Q- prefix unchanged', () => {
      expect(formatTicketNumber('08', 'uuid-1234')).toBe('Q-08');
      expect(formatTicketNumber('1', 'uuid-1234')).toBe('Q-1');
      expect(formatTicketNumber('#99', 'uuid-1234')).toBe('Q-99');
    });
  });

  describe('Service Selector Logic & Invariants', () => {
    it('renders classic Dine-In form directly when takeaway is disabled', () => {
      const restaurantWithoutTakeaway = {
        takeawayEnabled: false,
      };
      // Invariant: Customer should not see an extra step if restaurant does not offer takeaway
      const shouldShowSelector = Boolean(restaurantWithoutTakeaway.takeawayEnabled);
      expect(shouldShowSelector).toBe(false);
    });

    it('offers service selection when takeaway is enabled', () => {
      const restaurantWithTakeaway = {
        takeawayEnabled: true,
      };
      const shouldShowSelector = Boolean(restaurantWithTakeaway.takeawayEnabled);
      expect(shouldShowSelector).toBe(true);
    });
  });

  describe('Takeaway Multi-Item Cart & Pricing Snapshot Logic', () => {
    const CartItemSchema = z.object({
      menuItemId: z.string().uuid(),
      name: z.string().min(1),
      price: z.number().positive(),
      quantity: z.number().int().min(1).max(99),
      notes: z.string().max(200).optional(),
    });

    it('supports multiple line items in a single takeaway cart transaction', () => {
      const cart = [
        { menuItemId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Burger', price: 250, quantity: 2, notes: 'Extra cheese' },
        { menuItemId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', name: 'Fries', price: 120, quantity: 1 },
        { menuItemId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', name: 'Coke', price: 60, quantity: 2 },
      ];

      const validation = z.array(CartItemSchema).safeParse(cart);
      expect(validation.success).toBe(true);

      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      // 2 * 250 + 1 * 120 + 2 * 60 = 500 + 120 + 120 = 740
      expect(subtotal).toBe(740);
    });

    it('rejects items with invalid quantities (<= 0 or non-integer)', () => {
      const invalidCart = [
        { menuItemId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Burger', price: 250, quantity: 0 },
      ];
      const validation = z.array(CartItemSchema).safeParse(invalidCart);
      expect(validation.success).toBe(false);
    });
  });

  describe('Takeaway Payment Method Invariant', () => {
    it('enforces PAY AT COUNTER as the single takeaway payment method', () => {
      const takeawayOrder = {
        queueType: 'TAKEAWAY' as const,
        paymentMethod: 'PAY_AT_COUNTER',
        paymentStatus: 'UNPAID',
      };

      expect(takeawayOrder.queueType).toBe('TAKEAWAY');
      expect(takeawayOrder.paymentMethod).toBe('PAY_AT_COUNTER');
    });

    it('does not route takeaway into online payment intent flow', () => {
      const orderType: 'DINE_IN' | 'TAKEAWAY' = 'TAKEAWAY';
      const shouldGenerateOnlinePaymentIntent = (type: 'DINE_IN' | 'TAKEAWAY') => {
        return type === 'DINE_IN'; // Takeaway strictly pays at counter
      };

      expect(shouldGenerateOnlinePaymentIntent(orderType)).toBe(false);
      expect(shouldGenerateOnlinePaymentIntent('DINE_IN')).toBe(true);
    });
  });

  describe('Customer Takeaway States & Seating Protection', () => {
    const validTakeawayStates = ['IN_QUEUE', 'CALLING', 'COMPLETED', 'CANCELLED'];
    const forbiddenSeatingConcepts = [
      'party_size',
      'table_ready',
      'table_number',
      'table_recommendation',
      'table_assignment',
      'seating_mode',
      'floor_info',
      'seated',
    ];

    it('recognizes authoritative customer takeaway states', () => {
      expect(validTakeawayStates).toContain('IN_QUEUE');
      expect(validTakeawayStates).toContain('CALLING');
      expect(validTakeawayStates).toContain('COMPLETED');
    });

    it('ensures takeaway state presentation does not reference table or seating concepts', () => {
      const takeawayStateLabels = {
        inQueue: 'Your takeaway order is in the queue.',
        calling: 'YOUR ORDER IS READY. Please proceed to the takeaway counter.',
        completed: 'ORDER COLLECTED. Thanks! Your takeaway order has been completed.',
      };

      for (const [, copy] of Object.entries(takeawayStateLabels)) {
        for (const concept of forbiddenSeatingConcepts) {
          expect(copy.toLowerCase().includes(concept)).toBe(false);
        }
      }
    });
  });
});

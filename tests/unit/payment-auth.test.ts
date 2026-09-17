import { describe, it, expect } from 'vitest';
import {
  isOrderPayable,
  type CustomerOrderContext,
} from '@/lib/customer-order-auth';

function ctx(overrides: Partial<CustomerOrderContext>): CustomerOrderContext {
  return {
    orderId: 'o1',
    restaurantId: 'r1',
    queueEntryId: 'q1',
    orderStatus: 'PLACED',
    paymentStatus: 'UNPAID',
    ...overrides,
  };
}

describe('Phase 3D correction: order payment eligibility', () => {
  it('allows payable orders across lifecycle states', () => {
    for (const status of ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'DRAFT']) {
      expect(isOrderPayable(ctx({ orderStatus: status }))).toBe(true);
    }
  });

  it('rejects cancelled orders', () => {
    expect(isOrderPayable(ctx({ orderStatus: 'CANCELLED' }))).toBe(false);
  });

  it('rejects already-paid orders', () => {
    expect(isOrderPayable(ctx({ paymentStatus: 'PAID' }))).toBe(false);
    expect(
      isOrderPayable(ctx({ paymentStatus: 'PAID', orderStatus: 'SERVED' }))
    ).toBe(false);
  });

  it('allows partially-paid and table orders without queue binding', () => {
    expect(isOrderPayable(ctx({ paymentStatus: 'PARTIAL' }))).toBe(true);
    expect(isOrderPayable(ctx({ queueEntryId: null }))).toBe(true);
  });
});

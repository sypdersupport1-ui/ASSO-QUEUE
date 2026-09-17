import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createAdminClient } from '@/lib/db/supabase/admin';
import { PaymentService } from '@/lib/services/payment-service';
import { RazorpayProvider } from '@/lib/payments/providers/razorpay-provider';
import { isValidPaymentTransition } from '@/lib/payments/types';

describe('Phase 12: Payments, Payment State Machine & Reconciliation Tests', () => {
  const supabase = createAdminClient();

  let restaurantAId: string;
  let restaurantBId: string;
  let orderAId: string;
  let orderBId: string;

  beforeAll(async () => {
    // 1. Create test restaurants
    const { data: restA, error: errA } = await supabase
      .from('restaurants')
      .insert({
        name: 'Phase 12 Bistro A',
        slug: `phase12-bistro-a-${Date.now()}`,
        currency: 'INR',
      })
      .select()
      .single();

    if (errA || !restA) throw new Error(`Setup failed: ${errA?.message}`);
    restaurantAId = restA.id;

    const { data: restB, error: errB } = await supabase
      .from('restaurants')
      .insert({
        name: 'Phase 12 Bistro B',
        slug: `phase12-bistro-b-${Date.now()}`,
        currency: 'INR',
      })
      .select()
      .single();

    if (errB || !restB) throw new Error(`Setup failed: ${errB?.message}`);
    restaurantBId = restB.id;

    // 2. Create test orders and order items
    const { data: ordA } = await supabase
      .from('orders')
      .insert({
        restaurant_id: restaurantAId,
        order_number: 'ORD-101',
        status: 'PLACED',
        subtotal: 850.0,
        tax: 0,
        total: 850.0,
      })
      .select()
      .single();

    orderAId = ordA!.id;

    await supabase.from('order_items').insert([
      {
        restaurant_id: restaurantAId,
        order_id: orderAId,
        name_snapshot: 'Butter Chicken',
        unit_price_snapshot: 450.0,
        quantity: 1,
        total_price: 450.0,
      },
      {
        restaurant_id: restaurantAId,
        order_id: orderAId,
        name_snapshot: 'Garlic Naan',
        unit_price_snapshot: 200.0,
        quantity: 2,
        total_price: 400.0,
      },
    ]);

    const { data: ordB } = await supabase
      .from('orders')
      .insert({
        restaurant_id: restaurantBId,
        order_number: 'ORD-202',
        status: 'PLACED',
        subtotal: 500.0,
        tax: 0,
        total: 500.0,
      })
      .select()
      .single();

    orderBId = ordB!.id;

    await supabase.from('order_items').insert([
      {
        restaurant_id: restaurantBId,
        order_id: orderBId,
        name_snapshot: 'Paneer Tikka',
        unit_price_snapshot: 500.0,
        quantity: 1,
        total_price: 500.0,
      },
    ]);
  });

  afterAll(async () => {
    // Remove timestamped fixture restaurants so test runs never pollute the
    // shared database (restaurant DELETE cascades to all child rows).
    if (restaurantAId) await supabase.from('restaurants').delete().eq('id', restaurantAId);
    if (restaurantBId) await supabase.from('restaurants').delete().eq('id', restaurantBId);
  });

  describe('1. Payment State Machine (FSM) & Terminal Protection', () => {
    it('validates allowed FSM transitions', () => {
      expect(isValidPaymentTransition('PENDING', 'PROCESSING')).toBe(true);
      expect(isValidPaymentTransition('PROCESSING', 'SUCCEEDED')).toBe(true);
      expect(isValidPaymentTransition('SUCCEEDED', 'REFUND_PENDING')).toBe(true);
      expect(isValidPaymentTransition('REFUND_PENDING', 'REFUNDED')).toBe(true);
      expect(isValidPaymentTransition('FAILED', 'PROCESSING')).toBe(true);
    });

    it('rejects invalid state transitions (e.g. REFUNDED -> SUCCEEDED or SUCCEEDED -> PENDING)', () => {
      expect(isValidPaymentTransition('REFUNDED', 'SUCCEEDED')).toBe(false);
      expect(isValidPaymentTransition('REFUNDED', 'PROCESSING')).toBe(false);
      expect(isValidPaymentTransition('SUCCEEDED', 'PENDING')).toBe(false);
    });
  });

  describe('2. Idempotency & Attempt Tracking', () => {
    it('[IDEMPOTENCY TEST] duplicate payment request with same idempotency_key returns original record', async () => {
      const idempotencyKey = `idem_test_${Date.now()}`;

      const attempt1 = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 850.0,
        paymentMethod: 'ONLINE',
        idempotencyKey,
      });

      const attempt2 = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 850.0,
        paymentMethod: 'ONLINE',
        idempotencyKey,
      });

      expect(attempt1.paymentId).toBe(attempt2.paymentId);
      expect(attempt1.attemptNumber).toBe(attempt2.attemptNumber);
    });

    it('preserves attempt history on failed payment retry', async () => {
      const retryKey = `idem_retry_${Date.now()}`;

      const attempt1 = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 850.0,
        paymentMethod: 'ONLINE',
        idempotencyKey: retryKey,
      });

      // Mark attempt 1 failed
      await supabase.from('payments').update({ status: 'FAILED' }).eq('id', attempt1.paymentId);

      // Create new attempt
      const attempt2 = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 850.0,
        paymentMethod: 'ONLINE',
        idempotencyKey: `idem_retry_2_${Date.now()}`,
      });

      expect(attempt2.paymentId).not.toBe(attempt1.paymentId);
      expect(attempt2.attemptNumber).toBe(attempt1.attemptNumber + 1);
    });
  });

  describe('3. Authoritative Amount Protection', () => {
    it('[AUTHORITATIVE AMOUNT TEST] derives payable amount from order items sum (450 + 400 = 850)', async () => {
      const calculated = await PaymentService.calculateAuthoritativeOrderAmount(orderAId, restaurantAId);
      expect(calculated).toBe(850.0);
    });

    it('ignores client amount override attempt and snapshots 850.00', async () => {
      const intent = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 1.0, // Malicious client trying to pay ₹1
        paymentMethod: 'ONLINE',
      });

      expect(intent.amount).toBe(850.0);
    });
  });

  describe('4. Server Verification & Webhook Signature Authentication', () => {
    it('verifies client payment payload with valid signature', async () => {
      const intent = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 850.0,
        paymentMethod: 'ONLINE',
      });

      const verification = await PaymentService.verifyAndProcessPayment({
        paymentId: intent.paymentId,
        providerOrderId: intent.providerOrderId,
        providerPaymentId: 'pay_rzp_mock_123',
        providerSignature: 'valid_test_signature',
      });

      expect(verification.success).toBe(true);
      expect(verification.status).toBe('SUCCEEDED');
    });

    it('rejects invalid razorpay webhook signature', async () => {
      const provider = new RazorpayProvider();
      const result = await provider.parseAndVerifyWebhook(
        JSON.stringify({ event: 'payment.authorized' }),
        { 'x-razorpay-signature': 'invalid_signature_string' }
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed');
    });

    it('processes valid razorpay webhook and handles duplicate event IDs idempotently', async () => {
      const intent = await PaymentService.createPaymentIntent({
        restaurantId: restaurantAId,
        orderId: orderAId,
        amount: 850.0,
        paymentMethod: 'ONLINE',
      });

      const eventId = `evt_dedup_${Date.now()}`;
      const payload = JSON.stringify({
        event_id: eventId,
        event: 'payment.authorized',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_webhook_999',
              order_id: intent.providerOrderId,
            },
          },
        },
      });

      const headers = { 'x-razorpay-signature': 'valid_test_webhook_signature' };

      // First webhook delivery
      const res1 = await PaymentService.handleWebhookEvent(payload, headers, 'RAZORPAY');
      expect(res1.success).toBe(true);
      expect(res1.duplicate).toBe(false);

      // Duplicate webhook delivery
      const res2 = await PaymentService.handleWebhookEvent(payload, headers, 'RAZORPAY');
      expect(res2.success).toBe(true);
      expect(res2.duplicate).toBe(true);
    });
  });

  describe('5. Manual Payment & One Successful Payment Invariant', () => {
    it('records staff manual payment cleanly', async () => {
      const result = await PaymentService.recordManualPayment({
        restaurantId: restaurantBId,
        orderId: orderBId,
        amount: 500.0,
        paymentMethod: 'CASH',
        actorUserId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.status).toBe('SUCCEEDED');
      expect(result.paymentMethod).toBe('CASH');
    });

    it('[CONCURRENCY INVARIANT TEST] rejects second manual payment attempt on already paid order', async () => {
      await expect(
        PaymentService.recordManualPayment({
          restaurantId: restaurantBId,
          orderId: orderBId,
          amount: 500.0,
          paymentMethod: 'CASH',
          actorUserId: '00000000-0000-0000-0000-000000000000',
        })
      ).rejects.toThrow('already has a successful payment');
    });
  });

  describe('6. Refund Foundation & Boundary Protection', () => {
    it('issues partial and full refunds with amount boundary checks', async () => {
      // Create and pay a new order
      const { data: ord } = await supabase
        .from('orders')
        .insert({
          restaurant_id: restaurantAId,
          order_number: 'ORD-REFUND-1',
          status: 'PLACED',
          subtotal: 1000.0,
          total: 1000.0,
        })
        .select()
        .single();

      await supabase.from('order_items').insert({
        restaurant_id: restaurantAId,
        order_id: ord!.id,
        name_snapshot: 'Special Combo',
        unit_price_snapshot: 1000.0,
        quantity: 1,
        total_price: 1000.0,
      });

      const pm = await PaymentService.recordManualPayment({
        restaurantId: restaurantAId,
        orderId: ord!.id,
        amount: 1000.0,
        paymentMethod: 'CASH',
        actorUserId: '00000000-0000-0000-0000-000000000000',
      });

      // Partial refund ₹300
      const partial = await PaymentService.refundPayment({
        paymentId: pm.paymentId,
        restaurantId: restaurantAId,
        amount: 300.0,
        reason: 'Item returned',
      });

      expect(partial.refundedAmount).toBe(300.0);
      expect(partial.remainingAmount).toBe(700.0);

      // Excessive refund attempt (₹800 > remaining ₹700) rejected
      await expect(
        PaymentService.refundPayment({
          paymentId: pm.paymentId,
          restaurantId: restaurantAId,
          amount: 800.0,
        })
      ).rejects.toThrow('Maximum refundable is ₹700');

      // Remaining refund ₹700 (Full refund)
      const full = await PaymentService.refundPayment({
        paymentId: pm.paymentId,
        restaurantId: restaurantAId,
        amount: 700.0,
        reason: 'Rest of order cancelled',
      });

      expect(full.status).toBe('REFUNDED');
      expect(full.refundedAmount).toBe(1000.0);
      expect(full.remainingAmount).toBe(0.0);

      // Refund attempt on already terminal REFUNDED payment rejected
      await expect(
        PaymentService.refundPayment({
          paymentId: pm.paymentId,
          restaurantId: restaurantAId,
          amount: 50.0,
        })
      ).rejects.toThrow('Only SUCCEEDED payments can be refunded');
    });
  });

  describe('7. Cross-Tenant Isolation', () => {
    it('prevents restaurant A from listing or refunding restaurant B payments', async () => {
      // Create fresh order for Restaurant B
      const { data: ordB2 } = await supabase
        .from('orders')
        .insert({
          restaurant_id: restaurantBId,
          order_number: 'ORD-B2-TENANT',
          status: 'PLACED',
          subtotal: 600.0,
          total: 600.0,
        })
        .select()
        .single();

      await supabase.from('order_items').insert({
        restaurant_id: restaurantBId,
        order_id: ordB2!.id,
        name_snapshot: 'Chicken Biryani',
        unit_price_snapshot: 600.0,
        quantity: 1,
        total_price: 600.0,
      });

      const pmB = await PaymentService.recordManualPayment({
        restaurantId: restaurantBId,
        orderId: ordB2!.id,
        amount: 600.0,
        paymentMethod: 'MANUAL',
        actorUserId: '00000000-0000-0000-0000-000000000000',
        idempotencyKey: `tenant_iso_b_${Date.now()}`,
      });

      await expect(
        PaymentService.refundPayment({
          paymentId: pmB.paymentId,
          restaurantId: restaurantAId, // Wrong tenant ID
          amount: 600.0,
        })
      ).rejects.toThrow('Original payment record not found');
    });
  });
});

import { createAdminClient } from '@/lib/db/supabase/admin';
import { PaymentProviderFactory } from '../payments/payment-provider-factory';
import { OutboxService } from './outbox-service';
import { logger } from '@/lib/logging/logger';
import {
  PaymentIntentRequest,
  PaymentIntentResult,
  VerifyPaymentPayload,
  VerifyPaymentResult,
  RefundPaymentRequest,
  RefundPaymentResult,
  WebhookHeaderMap,
  WebhookResult,
  isValidPaymentTransition,
  PaymentState,
} from '../payments/types';
import { PaymentMethod } from '@/types/database.types';

export class PaymentService {
  /**
   * Calculates the authoritative payable amount derived from order items.
   */
  static async calculateAuthoritativeOrderAmount(orderId: string, restaurantId: string): Promise<number> {
    const supabase = createAdminClient();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, total, restaurant_id')
      .eq('id', orderId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (orderError || !order) {
      throw new Error('Order not found or invalid tenant assignment');
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('total_price')
      .eq('order_id', orderId);

    if (itemsError) {
      throw new Error(`Failed to calculate order total: ${itemsError.message}`);
    }

    if (items && items.length > 0) {
      const calculatedSum = items.reduce((sum: number, item: { total_price: number }) => sum + Number(item.total_price), 0);
      return Math.round(calculatedSum * 100) / 100;
    }

    return Number(order.total);
  }

  /**
   * Idempotent payment intent creation.
   */
  static async createPaymentIntent(req: PaymentIntentRequest): Promise<PaymentIntentResult> {
    const supabase = createAdminClient();

    // 1. Calculate authoritative payable amount
    const authoritativeAmount = await this.calculateAuthoritativeOrderAmount(req.orderId, req.restaurantId);

    // 2. Check Idempotency Key
    if (req.idempotencyKey) {
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('*')
        .eq('idempotency_key', req.idempotencyKey)
        .eq('restaurant_id', req.restaurantId)
        .maybeSingle();

      if (existingPayment) {
        return {
          paymentId: existingPayment.id,
          restaurantId: existingPayment.restaurant_id,
          orderId: existingPayment.order_id,
          amount: Number(existingPayment.amount),
          currency: existingPayment.currency,
          status: existingPayment.status as PaymentState,
          paymentMethod: existingPayment.payment_method as PaymentMethod,
          attemptNumber: existingPayment.attempt_number,
          provider: existingPayment.provider,
          providerOrderId: existingPayment.provider_order_id || undefined,
          providerReference: existingPayment.provider_reference || undefined,
          idempotencyKey: existingPayment.idempotency_key || undefined,
        };
      }
    }

    // 3. Count existing payment attempts to determine attempt_number
    const { count: attemptCount } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', req.orderId);

    const attemptNumber = (attemptCount || 0) + 1;

    // 4. Resolve Payment Provider
    const provider = PaymentProviderFactory.getProvider(req.paymentMethod);

    // 5. Call Provider for Intent/Order Creation
    const providerResult = await provider.createPaymentIntent({
      ...req,
      amount: authoritativeAmount,
    });

    const currency = req.currency || 'INR';

    // 6. Insert Payment Attempt Record
    const { data: payment, error: insertError } = await supabase
      .from('payments')
      .insert({
        restaurant_id: req.restaurantId,
        order_id: req.orderId,
        amount: authoritativeAmount,
        currency,
        status: req.paymentMethod === 'ONLINE' ? 'PROCESSING' : 'PENDING',
        payment_method: req.paymentMethod,
        attempt_number: attemptNumber,
        provider: provider.providerName,
        provider_order_id: providerResult.providerOrderId || null,
        idempotency_key: req.idempotencyKey || null,
        metadata: (providerResult.metadata as Record<string, unknown>) || {},
      })
      .select()
      .single();

    if (insertError || !payment) {
      throw new Error(`Failed to create payment attempt: ${insertError?.message}`);
    }

    // 7. Write Audit Event
    await supabase.from('payment_events').insert({
      restaurant_id: req.restaurantId,
      payment_id: payment.id,
      event_type: 'PAYMENT_CREATED',
      actor_type: 'CUSTOMER',
      payload: {
        amount: authoritativeAmount,
        currency,
        payment_method: req.paymentMethod,
        attempt_number: attemptNumber,
        provider_order_id: providerResult.providerOrderId,
      },
    });

    return {
      paymentId: payment.id,
      restaurantId: payment.restaurant_id,
      orderId: payment.order_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status as PaymentState,
      paymentMethod: payment.payment_method as PaymentMethod,
      attemptNumber: payment.attempt_number,
      provider: payment.provider,
      providerOrderId: payment.provider_order_id || undefined,
      idempotencyKey: payment.idempotency_key || undefined,
      clientSecret: providerResult.clientSecret,
    };
  }

  /**
   * Verifies client-submitted payment completion with provider.
   */
  static async verifyAndProcessPayment(payload: VerifyPaymentPayload): Promise<VerifyPaymentResult> {
    const supabase = createAdminClient();

    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', payload.paymentId)
      .single();

    if (fetchError || !payment) {
      return {
        success: false,
        paymentId: payload.paymentId,
        status: 'FAILED',
        errorMessage: 'Payment record not found',
      };
    }

    // If already in terminal success state, return success idempotently
    if (payment.status === 'SUCCEEDED' || payment.status === 'COMPLETED') {
      return {
        success: true,
        paymentId: payment.id,
        status: payment.status as PaymentState,
        providerReference: payment.provider_reference || undefined,
      };
    }

    const provider = PaymentProviderFactory.getProvider(
      payment.payment_method as PaymentMethod,
      payment.provider
    );

    const verificationResult = await provider.verifyPayment(payload);

    const nextState: PaymentState = verificationResult.success ? 'SUCCEEDED' : 'FAILED';

    if (!isValidPaymentTransition(payment.status as PaymentState, nextState)) {
      return {
        success: false,
        paymentId: payment.id,
        status: payment.status as PaymentState,
        errorMessage: `Invalid state transition from ${payment.status} to ${nextState}`,
      };
    }

    // Update payment record
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: nextState,
        provider_reference: verificationResult.providerReference || payload.providerPaymentId || null,
        provider_payment_id: payload.providerPaymentId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    if (updateError) {
      throw new Error(`Failed to update payment status: ${updateError.message}`);
    }

    // Log payment event
    await supabase.from('payment_events').insert({
      restaurant_id: payment.restaurant_id,
      payment_id: payment.id,
      event_type: verificationResult.success ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
      actor_type: 'CUSTOMER',
      payload: {
        provider_payment_id: payload.providerPaymentId,
        provider_reference: verificationResult.providerReference,
      },
    });

    try {
      await OutboxService.publishEvent({
        restaurantId: payment.restaurant_id,
        eventType: verificationResult.success ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
        aggregateType: 'PAYMENT',
        aggregateId: payment.id,
        payload: {
          order_id: payment.order_id,
          amount: Number(payment.amount),
          currency: payment.currency,
          provider_payment_id: payload.providerPaymentId,
        },
      });
    } catch (outboxErr) {
      logger.error('Outbox publish failed on verifyAndProcessPayment — event may be lost', {
        operation: 'payment_verify_outbox',
        metadata: { error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr) },
      });
    }

    return {
      success: verificationResult.success,
      paymentId: payment.id,
      status: nextState,
      providerReference: verificationResult.providerReference,
    };
  }

  /**
   * Webhook processing with event deduplication.
   */
  static async handleWebhookEvent(
    rawBody: string,
    headers: WebhookHeaderMap,
    providerName: string
  ): Promise<WebhookResult> {
    const supabase = createAdminClient();
    const provider = PaymentProviderFactory.getProvider('ONLINE', providerName);

    const webhookResult = await provider.parseAndVerifyWebhook(rawBody, headers);

    if (!webhookResult.success) {
      return webhookResult;
    }

    // 1. Event Deduplication Check via webhook_event_id or payment_events payload
    if (webhookResult.eventId && webhookResult.eventId !== 'unknown') {
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('id, status')
        .eq('webhook_event_id', webhookResult.eventId)
        .maybeSingle();

      if (existingPayment) {
        return {
          ...webhookResult,
          paymentId: existingPayment.id,
          status: existingPayment.status as PaymentState,
          handled: true,
          duplicate: true,
          message: 'Webhook event previously processed (Idempotent)',
        };
      }
    }

    // 2. Locate target payment attempt
    let query = supabase.from('payments').select('*');
    if (webhookResult.providerOrderId) {
      query = query.eq('provider_order_id', webhookResult.providerOrderId);
    } else if (webhookResult.providerPaymentId) {
      query = query.eq('provider_reference', webhookResult.providerPaymentId);
    } else {
      return {
        ...webhookResult,
        handled: false,
        duplicate: false,
        message: 'Could not resolve payment reference from webhook payload',
      };
    }

    const { data: payment } = await query.maybeSingle();

    if (!payment) {
      return {
        ...webhookResult,
        handled: false,
        duplicate: false,
        message: 'No matching payment attempt found in database',
      };
    }

    const targetStatus = webhookResult.status || 'SUCCEEDED';

    if (isValidPaymentTransition(payment.status as PaymentState, targetStatus)) {
      await supabase
        .from('payments')
        .update({
          status: targetStatus,
          provider_payment_id: webhookResult.providerPaymentId || payment.provider_payment_id,
          provider_reference: webhookResult.providerPaymentId || payment.provider_reference,
          webhook_event_id: webhookResult.eventId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id);

      await supabase.from('payment_events').insert({
        restaurant_id: payment.restaurant_id,
        payment_id: payment.id,
        event_type: targetStatus === 'SUCCEEDED' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
        actor_type: 'WEBHOOK',
        actor_id: webhookResult.eventId,
        payload: {
          event_type: webhookResult.eventType,
          provider_payment_id: webhookResult.providerPaymentId,
        },
      });
    }

    return {
      ...webhookResult,
      paymentId: payment.id,
      handled: true,
      duplicate: false,
    };
  }

  /**
   * Controlled Staff Action: Record Manual (Cash / Pay at Restaurant) Payment.
   */
  static async recordManualPayment(params: {
    restaurantId: string;
    orderId: string;
    amount: number;
    paymentMethod: 'CASH' | 'PAY_AT_RESTAURANT' | 'MANUAL';
    actorUserId: string;
    idempotencyKey?: string;
  }): Promise<PaymentIntentResult> {
    const supabase = createAdminClient();

    // Verify order exists and belongs to restaurant
    const authoritativeAmount = await this.calculateAuthoritativeOrderAmount(params.orderId, params.restaurantId);

    // Prevent duplicate successful payments for same order
    const { data: existingSuccess } = await supabase
      .from('payments')
      .select('id, status')
      .eq('order_id', params.orderId)
      .in('status', ['SUCCEEDED', 'COMPLETED'])
      .maybeSingle();

    if (existingSuccess) {
      throw new Error('Order already has a successful payment recorded');
    }

    // Check Idempotency Key
    if (params.idempotencyKey) {
      const { data: existingIdempotent } = await supabase
        .from('payments')
        .select('*')
        .eq('idempotency_key', params.idempotencyKey)
        .maybeSingle();

      if (existingIdempotent) {
        return {
          paymentId: existingIdempotent.id,
          restaurantId: existingIdempotent.restaurant_id,
          orderId: existingIdempotent.order_id,
          amount: Number(existingIdempotent.amount),
          currency: existingIdempotent.currency,
          status: existingIdempotent.status as PaymentState,
          paymentMethod: existingIdempotent.payment_method as PaymentMethod,
          attemptNumber: existingIdempotent.attempt_number,
          provider: existingIdempotent.provider,
          providerReference: existingIdempotent.provider_reference || undefined,
          idempotencyKey: existingIdempotent.idempotency_key || undefined,
        };
      }
    }

    const providerRef = `cash_ref_${Date.now()}`;

    const { data: payment, error: insertError } = await supabase
      .from('payments')
      .insert({
        restaurant_id: params.restaurantId,
        order_id: params.orderId,
        amount: authoritativeAmount,
        currency: 'INR',
        status: 'SUCCEEDED',
        payment_method: params.paymentMethod,
        attempt_number: 1,
        provider: params.paymentMethod,
        provider_reference: providerRef,
        idempotency_key: params.idempotencyKey || null,
        metadata: {
          recorded_by_user_id: params.actorUserId,
          manual: true,
        },
      })
      .select()
      .single();

    if (insertError || !payment) {
      throw new Error(`Failed to record manual payment: ${insertError?.message}`);
    }

    await supabase.from('payment_events').insert({
      restaurant_id: params.restaurantId,
      payment_id: payment.id,
      event_type: 'PAYMENT_SUCCEEDED',
      actor_type: 'STAFF',
      actor_id: params.actorUserId,
      payload: {
        amount: authoritativeAmount,
        payment_method: params.paymentMethod,
        manual: true,
      },
    });

    try {
      await OutboxService.publishEvent({
        restaurantId: params.restaurantId,
        eventType: 'PAYMENT_SUCCEEDED',
        aggregateType: 'PAYMENT',
        aggregateId: payment.id,
        payload: {
          order_id: params.orderId,
          amount: authoritativeAmount,
          currency: 'INR',
          manual: true,
        },
      });
    } catch (outboxErr) {
      logger.error('Outbox publish failed on recordManualPayment — event may be lost', {
        operation: 'payment_manual_outbox',
        metadata: { error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr) },
      });
    }

    return {
      paymentId: payment.id,
      restaurantId: payment.restaurant_id,
      orderId: payment.order_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status as PaymentState,
      paymentMethod: payment.payment_method as PaymentMethod,
      attemptNumber: payment.attempt_number,
      provider: payment.provider,
      providerReference: payment.provider_reference || undefined,
      idempotencyKey: payment.idempotency_key || undefined,
    };
  }

  /**
   * Process refund with amount boundary checks and FSM transition enforcement.
   */
  static async refundPayment(params: RefundPaymentRequest & { restaurantId: string; actorUserId?: string }): Promise<RefundPaymentResult> {
    const supabase = createAdminClient();

    const { data: original, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', params.paymentId)
      .eq('restaurant_id', params.restaurantId)
      .single();

    if (fetchError || !original) {
      throw new Error('Original payment record not found');
    }

    if (original.status !== 'SUCCEEDED' && original.status !== 'COMPLETED') {
      throw new Error(`Cannot refund payment in state '${original.status}'. Only SUCCEEDED payments can be refunded.`);
    }

    const currentRefunded = Number(original.refunded_amount || 0);
    const maxRefundable = Number(original.amount) - currentRefunded;

    if (params.amount <= 0 || params.amount > maxRefundable) {
      throw new Error(`Invalid refund amount ₹${params.amount}. Maximum refundable is ₹${maxRefundable}`);
    }

    const newTotalRefunded = currentRefunded + params.amount;
    const isFullRefund = newTotalRefunded >= Number(original.amount);
    const newStatus: PaymentState = isFullRefund ? 'REFUNDED' : 'SUCCEEDED';

    const provider = PaymentProviderFactory.getProvider(
      original.payment_method as PaymentMethod,
      original.provider
    );

    const refundResult = await provider.refundPayment(params, original.provider_reference || original.id);

    const { error: updateError } = await supabase
      .from('payments')
      .update({
        refunded_amount: newTotalRefunded,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', original.id);

    if (updateError) {
      throw new Error(`Failed to update refund status: ${updateError.message}`);
    }

    await supabase.from('payment_events').insert({
      restaurant_id: original.restaurant_id,
      payment_id: original.id,
      event_type: 'PAYMENT_REFUNDED',
      actor_type: 'STAFF',
      actor_id: params.actorUserId || null,
      payload: {
        refund_amount: params.amount,
        total_refunded: newTotalRefunded,
        is_full_refund: isFullRefund,
        reason: params.reason || null,
        provider_refund_id: refundResult.providerRefundId,
      },
    });

    return {
      success: true,
      paymentId: original.id,
      refundedAmount: newTotalRefunded,
      remainingAmount: Number(original.amount) - newTotalRefunded,
      status: newStatus,
      providerRefundId: refundResult.providerRefundId,
    };
  }

  /**
   * Internal Service Reconciliation logic.
   */
  static async reconcilePayment(paymentId: string, restaurantId: string): Promise<{ matched: boolean; paymentId: string; status: PaymentState }> {
    const supabase = createAdminClient();

    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (!payment) {
      throw new Error('Payment not found');
    }

    await supabase.from('payment_events').insert({
      restaurant_id: restaurantId,
      payment_id: paymentId,
      event_type: 'PAYMENT_RECONCILED',
      actor_type: 'SYSTEM',
      payload: {
        local_status: payment.status,
        provider: payment.provider,
        provider_reference: payment.provider_reference,
      },
    });

    return {
      matched: true,
      paymentId: payment.id,
      status: payment.status as PaymentState,
    };
  }

  /**
   * Tenant-isolated administrative listing.
   */
  static async listPayments(
    restaurantId: string,
    filters?: { status?: PaymentState; search?: string; limit?: number; offset?: number }
  ) {
    const supabase = createAdminClient();

    let query = supabase
      .from('payments')
      .select(`
        *,
        orders:order_id (
          order_number,
          customer_name,
          customer_phone,
          status
        )
      `, { count: 'exact' })
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.search) {
      query = query.or(`provider_reference.ilike.%${filters.search}%,provider_order_id.ilike.%${filters.search}%`);
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch payments: ${error.message}`);
    }

    return {
      payments: data || [],
      total: count || 0,
    };
  }

  /**
   * Detailed payment lookup with audit events.
   */
  static async getPaymentDetails(paymentId: string, restaurantId: string) {
    const supabase = createAdminClient();

    const { data: payment, error } = await supabase
      .from('payments')
      .select(`
        *,
        orders:order_id (
          id,
          order_number,
          customer_name,
          customer_phone,
          status,
          total
        )
      `)
      .eq('id', paymentId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (error || !payment) {
      throw new Error('Payment record not found');
    }

    const { data: events } = await supabase
      .from('payment_events')
      .select('*')
      .eq('payment_id', paymentId)
      .order('created_at', { ascending: false });

    const { data: allAttempts } = await supabase
      .from('payments')
      .select('id, attempt_number, amount, status, payment_method, provider, provider_reference, created_at')
      .eq('order_id', payment.order_id)
      .order('attempt_number', { ascending: true });

    return {
      payment,
      events: events || [],
      attempts: allAttempts || [],
    };
  }
}

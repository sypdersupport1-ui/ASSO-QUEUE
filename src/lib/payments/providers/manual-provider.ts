import { PaymentProvider } from './payment-provider.interface';
import {
  PaymentIntentRequest,
  VerifyPaymentPayload,
  VerifyPaymentResult,
  RefundPaymentRequest,
  RefundPaymentResult,
  WebhookHeaderMap,
  WebhookResult,
} from '../types';

export class ManualPaymentProvider implements PaymentProvider {
  readonly providerName: string;

  constructor(providerName: 'CASH' | 'PAY_AT_RESTAURANT' | 'MANUAL' = 'MANUAL') {
    this.providerName = providerName;
  }

  async createPaymentIntent(req: PaymentIntentRequest): Promise<{
    providerOrderId?: string;
    clientSecret?: string;
    metadata?: Record<string, unknown>;
  }> {
    const reference = `manual_${this.providerName.toLowerCase()}_${Date.now()}`;
    return {
      providerOrderId: reference,
      metadata: {
        method: req.paymentMethod,
        is_manual: true,
      },
    };
  }

  async verifyPayment(payload: VerifyPaymentPayload): Promise<VerifyPaymentResult> {
    return {
      success: true,
      paymentId: payload.paymentId,
      status: 'SUCCEEDED',
      providerReference: payload.providerPaymentId || `manual_received_${Date.now()}`,
    };
  }

  async refundPayment(req: RefundPaymentRequest, _originalProviderRef: string): Promise<RefundPaymentResult> {
    return {
      success: true,
      paymentId: req.paymentId,
      refundedAmount: req.amount,
      remainingAmount: 0,
      status: 'REFUNDED',
      providerRefundId: `manual_refund_${Date.now()}`,
    };
  }

  async parseAndVerifyWebhook(_rawBody: string, _headers: WebhookHeaderMap): Promise<WebhookResult> {
    return {
      success: false,
      eventId: 'none',
      eventType: 'none',
      handled: false,
      duplicate: false,
      message: 'Manual payments do not accept webhooks',
    };
  }
}

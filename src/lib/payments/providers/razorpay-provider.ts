import crypto from 'crypto';
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

export class RazorpayProvider implements PaymentProvider {
  readonly providerName = 'RAZORPAY';

  private getKeyId(): string {
    return process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key';
  }

  private getKeySecret(): string {
    return process.env.RAZORPAY_KEY_SECRET || 'rzp_test_placeholder_secret';
  }

  private getWebhookSecret(): string {
    return process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_test_webhook_secret';
  }

  async createPaymentIntent(req: PaymentIntentRequest): Promise<{
    providerOrderId?: string;
    clientSecret?: string;
    metadata?: Record<string, unknown>;
  }> {
    const amountInPaise = Math.round(req.amount * 100);
    const mockRazorpayOrderId = `order_rzp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // In production, an HTTP POST to Razorpay API https://api.razorpay.com/v1/orders with Basic Auth would occur.
    return {
      providerOrderId: mockRazorpayOrderId,
      clientSecret: this.getKeyId(),
      metadata: {
        amount_paise: amountInPaise,
        currency: req.currency || 'INR',
      },
    };
  }

  async verifyPayment(payload: VerifyPaymentPayload): Promise<VerifyPaymentResult> {
    const { paymentId, providerOrderId, providerPaymentId, providerSignature } = payload;

    if (!providerPaymentId || !providerOrderId || !providerSignature) {
      return {
        success: false,
        paymentId,
        status: 'FAILED',
        errorMessage: 'Missing required Razorpay verification parameters',
      };
    }

    // Razorpay signature verification logic: HmacSHA256(providerOrderId + "|" + providerPaymentId, keySecret)
    // Phase 3E: the test-signature bypass exists ONLY outside production.
    // In production it would let anyone mark their own payment SUCCEEDED
    // without paying (the customer verify route is credential-gated, but the
    // customer IS the caller there — the signature is the payment proof).
    if (
      providerSignature === 'valid_test_signature' &&
      process.env.NODE_ENV !== 'production'
    ) {
      return {
        success: true,
        paymentId,
        status: 'SUCCEEDED',
        providerReference: providerPaymentId,
      };
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.getKeySecret())
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest('hex');

    const buf1 = Buffer.from(providerSignature);
    const buf2 = Buffer.from(expectedSignature);
    const isValid = buf1.length === buf2.length && crypto.timingSafeEqual(buf1, buf2);

    if (!isValid) {
      return {
        success: false,
        paymentId,
        status: 'FAILED',
        errorMessage: 'Invalid Razorpay payment signature',
      };
    }

    return {
      success: true,
      paymentId,
      status: 'SUCCEEDED',
      providerReference: providerPaymentId,
    };
  }

  async refundPayment(req: RefundPaymentRequest, _originalProviderRef: string): Promise<RefundPaymentResult> {
    const refundId = `rfnd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      success: true,
      paymentId: req.paymentId,
      refundedAmount: req.amount,
      remainingAmount: 0,
      status: 'REFUNDED',
      providerRefundId: refundId,
    };
  }

  async parseAndVerifyWebhook(rawBody: string, headers: WebhookHeaderMap): Promise<WebhookResult> {
    const signature = (headers['x-razorpay-signature'] || headers['X-Razorpay-Signature']) as string;
    
    if (!signature) {
      return {
        success: false,
        eventId: 'unknown',
        eventType: 'unknown',
        handled: false,
        duplicate: false,
        message: 'Missing x-razorpay-signature header',
      };
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', this.getWebhookSecret())
      .update(rawBody)
      .digest('hex');

    // Phase 3E: test bypass outside production only (see verifyPayment).
    const signatureValid =
      signature === expectedSignature ||
      (signature === 'valid_test_webhook_signature' && process.env.NODE_ENV !== 'production');

    if (!signatureValid) {
      return {
        success: false,
        eventId: 'unknown',
        eventType: 'unknown',
        handled: false,
        duplicate: false,
        message: 'Razorpay webhook signature verification failed',
      };
    }

    try {
      const payload = JSON.parse(rawBody);
      const eventId = payload.event_id || payload.id || `evt_${Date.now()}`;
      const eventType = payload.event || 'payment.authorized';
      const entity = payload.payload?.payment?.entity || {};

      const providerPaymentId = entity.id;
      const providerOrderId = entity.order_id;

      let status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' = 'SUCCEEDED';
      if (eventType.includes('failed')) status = 'FAILED';
      if (eventType.includes('refunded')) status = 'REFUNDED';

      return {
        success: true,
        eventId,
        eventType,
        providerOrderId,
        providerPaymentId,
        status,
        handled: true,
        duplicate: false,
      };
    } catch {
      return {
        success: false,
        eventId: 'malformed',
        eventType: 'unknown',
        handled: false,
        duplicate: false,
        message: 'Malformed JSON payload',
      };
    }
  }
}

import {
  PaymentIntentRequest,
  VerifyPaymentPayload,
  VerifyPaymentResult,
  RefundPaymentRequest,
  RefundPaymentResult,
  WebhookHeaderMap,
  WebhookResult,
} from '../types';

export interface PaymentProvider {
  readonly providerName: string;

  /**
   * Creates a payment intent or order with the external payment gateway.
   */
  createPaymentIntent(req: PaymentIntentRequest): Promise<{
    providerOrderId?: string;
    clientSecret?: string;
    metadata?: Record<string, unknown>;
  }>;

  /**
   * Verifies the authenticity of a completed payment from the frontend or gateway callback.
   */
  verifyPayment(payload: VerifyPaymentPayload): Promise<VerifyPaymentResult>;

  /**
   * Processes a refund attempt with the payment gateway.
   */
  refundPayment(req: RefundPaymentRequest, originalProviderRef: string): Promise<RefundPaymentResult>;

  /**
   * Parses and authenticates an incoming server-to-server webhook request.
   */
  parseAndVerifyWebhook(rawBody: string, headers: WebhookHeaderMap): Promise<WebhookResult>;
}

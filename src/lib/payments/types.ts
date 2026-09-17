import { TransactionPaymentStatus, PaymentMethod } from '@/types/database.types';

export type PaymentState = TransactionPaymentStatus;

export interface PaymentIntentRequest {
  restaurantId: string;
  orderId: string;
  amount: number; // In main currency units e.g. 850.00
  currency?: string; // Default 'INR'
  paymentMethod: PaymentMethod;
  idempotencyKey?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface PaymentIntentResult {
  paymentId: string;
  restaurantId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentState;
  paymentMethod: PaymentMethod;
  attemptNumber: number;
  provider: string;
  providerOrderId?: string;
  providerReference?: string;
  idempotencyKey?: string;
  clientSecret?: string; // Token/Secret for frontend payment SDK
}

export interface VerifyPaymentPayload {
  paymentId: string;
  providerPaymentId?: string;
  providerOrderId?: string;
  providerSignature?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  paymentId: string;
  status: PaymentState;
  providerReference?: string;
  errorMessage?: string;
}

export interface RefundPaymentRequest {
  paymentId: string;
  amount: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface RefundPaymentResult {
  success: boolean;
  paymentId: string;
  refundedAmount: number;
  remainingAmount: number;
  status: PaymentState;
  providerRefundId?: string;
}

export interface WebhookHeaderMap {
  [key: string]: string | string[] | undefined;
}

export interface WebhookResult {
  success: boolean;
  eventId: string;
  eventType: string;
  paymentId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  status?: PaymentState;
  handled: boolean;
  duplicate: boolean;
  message?: string;
}

// Payment FSM Transition Validator
export const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  PENDING: ['PROCESSING', 'FAILED', 'SUCCEEDED', 'COMPLETED'],
  PROCESSING: ['SUCCEEDED', 'COMPLETED', 'FAILED'],
  SUCCEEDED: ['REFUND_PENDING', 'REFUNDED'],
  COMPLETED: ['REFUND_PENDING', 'REFUNDED'],
  FAILED: ['PROCESSING', 'PENDING'], // Allowed for retry
  REFUND_PENDING: ['REFUNDED', 'SUCCEEDED', 'COMPLETED'],
  REFUNDED: [], // Terminal state
};

export function isValidPaymentTransition(fromState: PaymentState, toState: PaymentState): boolean {
  if (fromState === toState) return true;
  const allowed = ALLOWED_PAYMENT_TRANSITIONS[fromState];
  return allowed ? allowed.includes(toState) : false;
}

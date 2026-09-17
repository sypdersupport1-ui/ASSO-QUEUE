'use server';

import { requireAuth } from '@/lib/auth/session';
import { PaymentService } from '@/lib/services/payment-service';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PaymentState } from '@/lib/payments/types';

export async function fetchPaymentsAction(
  restaurantId: string,
  filters?: { status?: PaymentState; search?: string; limit?: number; offset?: number }
) {
  const authUser = await requireAuth();

  const canView = await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.view',
  });

  if (!canView) {
    throw new Error('Unauthorized to view payments for this restaurant');
  }

  return PaymentService.listPayments(restaurantId, filters);
}

export async function fetchPaymentDetailsAction(paymentId: string, restaurantId: string) {
  const authUser = await requireAuth();

  const canView = await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.view',
  });

  if (!canView) {
    throw new Error('Unauthorized to view payment details');
  }

  return PaymentService.getPaymentDetails(paymentId, restaurantId);
}

export async function recordManualPaymentAction(
  restaurantId: string,
  orderId: string,
  paymentMethod: 'CASH' | 'PAY_AT_RESTAURANT' | 'MANUAL'
) {
  const authUser = await requireAuth();

  const canManage = await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.create',
  }) || await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.manage',
  });

  if (!canManage) {
    throw new Error('Unauthorized to record manual payment');
  }

  return PaymentService.recordManualPayment({
    restaurantId,
    orderId,
    amount: 0,
    paymentMethod,
    actorUserId: authUser.id,
  });
}

export async function processRefundAction(
  restaurantId: string,
  paymentId: string,
  amount: number,
  reason?: string
) {
  const authUser = await requireAuth();

  const canRefund = await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.refund',
  }) || await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.manage',
  });

  if (!canRefund) {
    throw new Error('Unauthorized to issue refunds');
  }

  return PaymentService.refundPayment({
    paymentId,
    restaurantId,
    amount,
    reason,
    actorUserId: authUser.id,
  });
}

export async function reconcilePaymentAction(restaurantId: string, paymentId: string) {
  const authUser = await requireAuth();

  const canReconcile = await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.reconcile',
  }) || await AuthorizationService.hasPermission({
    userId: authUser.id,
    restaurantId,
    permission: 'payments.manage',
  });

  if (!canReconcile) {
    throw new Error('Unauthorized to perform payment reconciliation');
  }

  return PaymentService.reconcilePayment(paymentId, restaurantId);
}

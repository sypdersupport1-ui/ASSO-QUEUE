import { NextRequest, NextResponse } from 'next/server';
import { PaymentService } from '@/lib/services/payment-service';
import { requireAuth } from '@/lib/auth/session';
import { AuthorizationService } from '@/lib/services/authorization-service';

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth();
    const body = await req.json();
    const { paymentId, restaurantId, amount, reason } = body;

    if (!paymentId || !restaurantId || typeof amount !== 'number') {
      return NextResponse.json(
        { error: 'Missing required parameters: paymentId, restaurantId, amount' },
        { status: 400 }
      );
    }

    const hasPermission = await AuthorizationService.hasPermission({
      userId: authUser.id,
      restaurantId,
      permission: 'payments.refund',
    }) || await AuthorizationService.hasPermission({
      userId: authUser.id,
      restaurantId,
      permission: 'payments.manage',
    });

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions to issue refund' },
        { status: 403 }
      );
    }

    const result = await PaymentService.refundPayment({
      paymentId,
      restaurantId,
      amount,
      reason,
      actorUserId: authUser.id,
    });

    return NextResponse.json(result);
  } catch {
    // Phase 3E: raw service/DB errors must never reach callers.
    return NextResponse.json({ error: 'Failed to issue refund' }, { status: 400 });
  }
}

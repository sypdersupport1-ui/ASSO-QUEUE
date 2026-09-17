import { NextRequest, NextResponse } from 'next/server';
import { PaymentService } from '@/lib/services/payment-service';
import { requireAuth } from '@/lib/auth/session';
import { AuthorizationService } from '@/lib/services/authorization-service';

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth();
    const body = await req.json();
    const { restaurantId, orderId, paymentMethod, idempotencyKey } = body;

    if (!restaurantId || !orderId || !paymentMethod) {
      return NextResponse.json(
        { error: 'Missing required parameters: restaurantId, orderId, paymentMethod' },
        { status: 400 }
      );
    }

    // Check staff permission
    const hasPermission = await AuthorizationService.hasPermission({
      userId: authUser.id,
      restaurantId,
      permission: 'payments.create',
    }) || await AuthorizationService.hasPermission({
      userId: authUser.id,
      restaurantId,
      permission: 'payments.manage',
    });

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions to record manual payment' },
        { status: 403 }
      );
    }

    const result = await PaymentService.recordManualPayment({
      restaurantId,
      orderId,
      amount: 0,
      paymentMethod,
      actorUserId: authUser.id,
      idempotencyKey,
    });

    return NextResponse.json(result);
  } catch {
    // Phase 3E: raw service/DB errors must never reach callers.
    return NextResponse.json({ error: 'Failed to record manual payment' }, { status: 400 });
  }
}

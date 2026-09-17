import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { NotificationService } from '@/lib/services/notification-service';

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth();
    const { searchParams } = new URL(req.url);
    const restaurantId = searchParams.get('restaurantId');

    if (!restaurantId) {
      return NextResponse.json({ error: 'Missing restaurantId' }, { status: 400 });
    }

    const canView = await AuthorizationService.hasPermission({
      userId: authUser.id,
      restaurantId,
      permission: 'notifications.view',
    });

    if (!canView) {
      return NextResponse.json({ error: 'Forbidden: Cannot view notifications for this restaurant' }, { status: 403 });
    }

    const notifications = await NotificationService.getStaffNotifications(restaurantId);

    return NextResponse.json({ notifications });
  } catch {
    // Phase 3E: raw service/DB errors must never reach callers.
    return NextResponse.json({ error: 'Failed to fetch staff notifications' }, { status: 500 });
  }
}

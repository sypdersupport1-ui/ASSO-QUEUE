import React from 'react';
import { requireAuth } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { OrderService } from '@/lib/services/order-service';
import { redirect } from 'next/navigation';
import { KitchenDisplayClient } from '@/components/dashboard/KitchenDisplayClient';
import { KitchenRealtime } from '@/components/realtime/OrderRealtime';

export default async function KitchenDisplayPage() {
  const user = await requireAuth();
  const supabase = createAdminClient();

  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('restaurant_id, restaurants(name)')
    .eq('user_id', user.id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  const restaurantId = membership?.restaurant_id;

  if (!restaurantId) {
    redirect('/dashboard');
  }

  await AuthorizationService.requirePermission({
    userId: user.id,
    restaurantId,
    permission: PERMISSIONS.KITCHEN_VIEW,
  });

  const orders = await OrderService.listKitchenOrders(restaurantId);
  const restaurantName = (membership as unknown as { restaurants?: { name?: string } | null })?.restaurants?.name || 'Kitchen Display';

  return (
    <div className="space-y-6 animate-in fade-in duration-300 p-3 sm:p-0">
      <KitchenRealtime restaurantId={restaurantId} />

      <KitchenDisplayClient
        initialOrders={orders}
        restaurantId={restaurantId}
        restaurantName={restaurantName}
        userId={user.id}
      />
    </div>
  );
}


import React from 'react';
import { requireAuth } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { OrderService } from '@/lib/services/order-service';
import { redirect } from 'next/navigation';
import { StaffOrdersClient } from '@/components/dashboard/StaffOrdersClient';
import { OrderRealtime } from '@/components/realtime/OrderRealtime';

export default async function StaffOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const user = await requireAuth();
  const params = await searchParams;
  const supabase = createAdminClient();

  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('restaurant_id')
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
    permission: PERMISSIONS.ORDERS_VIEW,
  });

  const orders = await OrderService.listDashboardOrders(
    restaurantId,
    params.status,
    params.search
  );

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500 p-4 sm:p-0">
      <OrderRealtime restaurantId={restaurantId} />
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900/40 via-blue-900/20 to-slate-900/40 border border-white/10 p-5 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-blue-500/20 rounded-full blur-[80px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] pointer-events-none"></div>
        
        <div className="relative z-10">
          <h1 className="text-[22px] sm:text-3xl font-black text-white tracking-tight">Order Management</h1>
          <p className="text-[13px] sm:text-sm text-slate-400 mt-1.5 max-w-xl leading-relaxed">
            Monitor orders, preparation status, and table deliveries live.
          </p>
        </div>
      </div>

      <StaffOrdersClient
        orders={orders}
        restaurantId={restaurantId}
        userId={user.id}
        initialStatus={params.status || 'ALL'}
        initialSearch={params.search || ''}
      />
    </div>
  );
}

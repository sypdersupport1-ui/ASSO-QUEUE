'use client';

import React, { useState, useEffect, useTransition, useOptimistic } from 'react';
import { updateKitchenStatusAction } from '@/app/dashboard/actions';
import { useRouter } from 'next/navigation';

export interface KitchenOrderItem {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  queueDisplayNumber?: string | null;
  tableId?: string | null;
  createdAt: string;
  total: number;
  items: Array<{
    id: string;
    name: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
    notes?: string | null;
  }>;
}

interface KitchenDisplayClientProps {
  initialOrders: KitchenOrderItem[];
  restaurantId: string;
  userId: string;
}

type KitchenStatus = 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

function getTicketStatusBadge(status: string) {
  switch (status) {
    case 'PLACED':    return 'bg-blue-500/20 text-blue-400 border-blue-500/40 ring-1 ring-blue-400/30';
    case 'CONFIRMED': return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 ring-1 ring-indigo-400/30';
    case 'PREPARING': return 'bg-amber-500/20 text-amber-400 border-amber-500/40 ring-1 ring-amber-400/30 animate-pulse';
    case 'READY':     return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 ring-1 ring-emerald-400/30';
    default:          return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}

function getElapsedTimeMins(createdAt: string) {
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(elapsedMs / 60000);
  return mins <= 0 ? 'Just now' : `${mins} min ago`;
}

/**
 * Individual kitchen ticket with its own transition + optimistic status.
 *
 * WHY PER-TICKET:
 *   The old design used ONE global isPending. Clicking "Start Preparing" on
 *   ticket A disabled ALL buttons on ALL tickets — a nightmare for busy kitchens.
 *   Now each ticket has its own transition, and status changes are INSTANT
 *   (optimistic) — no waiting for the server response to update the UI.
 */
function KitchenTicket({
  order,
  restaurantId,
  userId,
  onCompleted,
}: {
  order: KitchenOrderItem;
  restaurantId: string;
  userId: string;
  onCompleted: (orderId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(order.status);

  const handleKitchenStatus = (targetStatus: KitchenStatus) => {
    startTransition(async () => {
      // Instant visual update
      setOptimisticStatus(targetStatus);
      await updateKitchenStatusAction(order.id, targetStatus, restaurantId, userId);
      // Remove from kitchen display when served/cancelled
      if (targetStatus === 'SERVED' || targetStatus === 'CANCELLED') {
        onCompleted(order.id);
      }
    });
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border backdrop-blur-md p-5 space-y-4 flex flex-col justify-between transition-all duration-300 ${
        optimisticStatus === 'PREPARING'
          ? 'bg-[#111827]/80 border-amber-500/50 shadow-[0_8px_30px_rgba(245,158,11,0.2)]'
          : optimisticStatus === 'READY'
          ? 'bg-[#111827]/80 border-emerald-500/50 shadow-[0_8px_30px_rgba(16,185,129,0.2)]'
          : isPending
          ? 'bg-slate-900/60 border-white/5 opacity-80 scale-[0.98]'
          : 'bg-[#111827]/80 border-white/10 hover:border-white/20'
      }`}
    >
      {/* Decorative gradient based on status */}
      <div className={`absolute top-0 right-0 w-32 h-32 blur-[50px] opacity-20 pointer-events-none rounded-full transition-colors ${
        optimisticStatus === 'PREPARING' ? 'bg-amber-500' :
        optimisticStatus === 'READY' ? 'bg-emerald-500' : 'bg-transparent'
      }`}></div>

      {/* Ticket Top */}
      <div className="relative z-10 space-y-4">
        <div className="flex items-start justify-between border-b border-white/5 pb-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono font-black text-white text-base tracking-tight">
                #{order.orderNumber}
              </span>
              {order.queueDisplayNumber && (
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                  {order.queueDisplayNumber}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <span className="material-symbols-outlined text-[14px]">person</span>
              {order.customerName}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase border transition-all shadow-sm ${getTicketStatusBadge(optimisticStatus)}`}
            >
              {optimisticStatus}
            </span>
            <div className="flex items-center gap-2">
              {isPending && (
                <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-white rounded-full animate-spin" />
              )}
              <div className="text-[10px] font-mono text-slate-400">
                ⏱️ {getElapsedTimeMins(order.createdAt)}
              </div>
            </div>
          </div>
        </div>

        {/* Items List */}
        <div className="space-y-2.5">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="bg-black/20 border border-white/5 rounded-xl p-3 flex items-start justify-between gap-3"
            >
              <div>
                <div className="font-bold text-white text-sm">
                  <span className="text-amber-400 font-mono font-black mr-1.5">
                    {item.quantity}×
                  </span>
                  {item.name}
                </div>
                {item.notes && (
                  <div className="text-xs text-amber-300 font-medium bg-amber-500/10 border border-amber-500/20 rounded-lg p-1.5 mt-2">
                    <span className="font-bold">Note:</span> {item.notes}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Kitchen Action Buttons — only THIS ticket is disabled when pending */}
      <div className="relative z-10 border-t border-white/5 pt-4">
        {optimisticStatus === 'PLACED' && (
          <button
            type="button"
            onClick={() => handleKitchenStatus('CONFIRMED')}
            disabled={isPending}
            className="w-full py-3 bg-blue-600/90 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500/50"
          >
            Accept Order
          </button>
        )}

        {optimisticStatus === 'CONFIRMED' && (
          <button
            type="button"
            onClick={() => handleKitchenStatus('PREPARING')}
            disabled={isPending}
            className="w-full py-3 bg-amber-600/90 hover:bg-amber-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(217,119,6,0.3)] hover:shadow-[0_0_20px_rgba(217,119,6,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500/50 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">skillet</span>
            Start Preparing
          </button>
        )}

        {optimisticStatus === 'PREPARING' && (
          <button
            type="button"
            onClick={() => handleKitchenStatus('READY')}
            disabled={isPending}
            className="w-full py-3 bg-emerald-600/90 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/50 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">notifications_active</span>
            Mark Ready
          </button>
        )}

        {optimisticStatus === 'READY' && (
          <button
            type="button"
            onClick={() => handleKitchenStatus('SERVED')}
            disabled={isPending}
            className="w-full py-3 bg-primary/90 hover:bg-primary text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-primary/50 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">room_service</span>
            Mark Served
          </button>
        )}
      </div>
    </div>
  );
}

export function KitchenDisplayClient({
  initialOrders,
  restaurantId,
  userId,
}: KitchenDisplayClientProps) {
  const router = useRouter();

  // Local order list — tickets disappear instantly when served/cancelled (optimistic)
  const [orders, setOrders] = useState<KitchenOrderItem[]>(initialOrders);

  // Sync when server re-renders with fresh data
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  // Polling — 30s, visibility-aware (was 10s, hammered DB)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) router.refresh();
      }, 30000);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    start();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' ? start() : stop());
    window.addEventListener('online', start);
    window.addEventListener('offline', stop);
    return () => { stop(); document.removeEventListener('visibilitychange', start); window.removeEventListener('online', start); window.removeEventListener('offline', stop); };
  }, [router]);

  // Called by a ticket when it reaches a terminal state — removes it from local list instantly
  const handleTicketCompleted = (orderId: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  return (
    <div className="space-y-6">
      {orders.length === 0 ? (
        <div className="bg-[#111827] border border-white/5 rounded-2xl p-10 sm:p-16 text-center space-y-3 shadow-sm">
          <div className="text-4xl sm:text-5xl">👨‍🍳</div>
          <h3 className="text-base sm:text-lg font-bold text-white">Kitchen Queue Clear</h3>
          <p className="text-xs sm:text-sm text-slate-400">
            No active orders waiting for preparation.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {orders.map((order) => (
            <KitchenTicket
              key={order.id}
              order={order}
              restaurantId={restaurantId}
              userId={userId}
              onCompleted={handleTicketCompleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

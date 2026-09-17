'use client';

import React, { useState, useTransition, useOptimistic } from 'react';
import { updateOrderStatusAction } from '@/app/dashboard/actions';
import { useRouter } from 'next/navigation';

export interface DashboardOrderItem {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerPhone?: string | null;
  queueDisplayNumber?: string | null;
  tableId?: string | null;
  total: number;
  itemCount: number;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
    notes?: string | null;
  }>;
}

interface StaffOrdersClientProps {
  orders: DashboardOrderItem[];
  restaurantId: string;
  userId: string;
  initialStatus: string;
  initialSearch: string;
}

const STATUS_FILTERS = ['ALL', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];

type OrderStatus = 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

function getStatusBadge(status: string) {
  switch (status) {
    case 'PLACED':      return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    case 'CONFIRMED':   return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
    case 'PREPARING':   return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'READY':       return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'SERVED':      return 'bg-slate-800 text-slate-300 border-slate-700';
    case 'CANCELLED':   return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    default:            return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}

function formatPrice(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Individual order card with its own useTransition + optimistic status.
 *
 * WHY PER-CARD TRANSITION:
 *   The old design had ONE global isPending boolean shared across all orders.
 *   Clicking "Confirm" on Order A disabled every button on the page.
 *   Now each card has its own transition — other cards stay fully interactive.
 *
 * WHY useOptimistic:
 *   The status badge and action buttons update INSTANTLY on click (optimistic).
 *   The server action runs in the background. If it fails, React reverts.
 *   This makes every button feel sub-50ms even when the DB takes 500ms.
 */
function OrderCard({
  order,
  restaurantId,
  userId,
}: {
  order: DashboardOrderItem;
  restaurantId: string;
  userId: string;
}) {
  const [isPending, startTransition] = useTransition();

  // Optimistic status — shown immediately on click, reverts on server error
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(order.status);

  const handleTransition = (targetStatus: OrderStatus) => {
    startTransition(async () => {
      // 1. Instant visual update — no waiting for server
      setOptimisticStatus(targetStatus);
      // 2. Actual DB write in background
      await updateOrderStatusAction(order.id, targetStatus, restaurantId, userId);
    });
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border backdrop-blur-md p-5 space-y-4 flex flex-col justify-between transition-all duration-300 ${
        isPending
          ? 'bg-slate-900/60 border-white/5 opacity-80 scale-[0.98]'
          : 'bg-[#111827]/80 border-white/10 hover:border-white/20 hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1'
      }`}
    >
      {/* Decorative gradient based on status */}
      <div className={`absolute top-0 right-0 w-32 h-32 blur-[50px] opacity-20 pointer-events-none rounded-full transition-colors ${
        optimisticStatus === 'PLACED' ? 'bg-blue-500' :
        optimisticStatus === 'CONFIRMED' ? 'bg-indigo-500' :
        optimisticStatus === 'PREPARING' ? 'bg-amber-500' :
        optimisticStatus === 'READY' ? 'bg-emerald-500' : 'bg-transparent'
      }`}></div>
      
      <div className="relative z-10 space-y-4">
        {/* Header */}
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
              className={`px-3 py-1 rounded-full text-[10px] font-black tracking-wider uppercase border transition-all shadow-sm ${getStatusBadge(optimisticStatus)}`}
            >
              {optimisticStatus}
            </span>
            {isPending && (
              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-white rounded-full animate-spin" />
            )}
          </div>
        </div>

        {/* Items Summary */}
        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs text-slate-300"
            >
              <span>
                <strong className="text-white font-mono">{item.quantity}×</strong>{' '}
                {item.name}
              </span>
              <span className="font-mono text-slate-400 text-[11px]">
                {formatPrice(item.totalPrice)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Total & FSM Actions */}
      <div className="relative z-10 border-t border-white/5 pt-4 space-y-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">restaurant</span>
            {order.itemCount} items
          </span>
          <span className="font-mono font-bold text-white text-base tracking-tight">
            {formatPrice(order.total)}
          </span>
        </div>

        {/* FSM Actions — buttons only disabled for THIS card when pending */}
        <div className="flex flex-wrap gap-2 pt-1">
          {optimisticStatus === 'PLACED' && (
            <>
              <button
                type="button"
                onClick={() => handleTransition('CONFIRMED')}
                disabled={isPending}
                className="flex-1 py-2.5 px-4 bg-indigo-600/90 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[0_0_20px_rgba(79,70,229,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-500/50"
              >
                Confirm Order
              </button>
              <button
                type="button"
                onClick={() => handleTransition('CANCELLED')}
                disabled={isPending}
                className="py-2.5 px-4 bg-slate-800/80 hover:bg-rose-500/20 text-rose-400 border border-transparent hover:border-rose-500/30 font-bold text-xs rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </>
          )}

          {optimisticStatus === 'CONFIRMED' && (
            <button
              type="button"
              onClick={() => handleTransition('PREPARING')}
              disabled={isPending}
              className="w-full py-2.5 px-4 bg-amber-600/90 hover:bg-amber-500 text-white font-bold text-xs rounded-xl transition-all shadow-[0_0_15px_rgba(217,119,6,0.3)] hover:shadow-[0_0_20px_rgba(217,119,6,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500/50"
            >
              Start Preparation
            </button>
          )}

          {optimisticStatus === 'PREPARING' && (
            <button
              type="button"
              onClick={() => handleTransition('READY')}
              disabled={isPending}
              className="w-full py-2.5 px-4 bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/50"
            >
              Mark Ready
            </button>
          )}

          {optimisticStatus === 'READY' && (
            <button
              type="button"
              onClick={() => handleTransition('SERVED')}
              disabled={isPending}
              className="w-full py-2.5 px-4 bg-primary/90 hover:bg-primary text-white font-bold text-xs rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] disabled:opacity-50 disabled:cursor-not-allowed border border-primary/50 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Mark Served
            </button>
          )}

          {(optimisticStatus === 'SERVED' || optimisticStatus === 'CANCELLED') && (
            <div className="w-full text-center text-xs font-bold px-4 py-3 rounded-xl bg-black/20 border border-white/5 flex items-center justify-center gap-2">
              <span className={`material-symbols-outlined text-[16px] ${optimisticStatus === 'SERVED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {optimisticStatus === 'SERVED' ? 'task_alt' : 'cancel'}
              </span>
              <span className={optimisticStatus === 'SERVED' ? 'text-emerald-300' : 'text-rose-300'}>
                {optimisticStatus === 'SERVED' ? 'Order Completed' : 'Order Cancelled'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function StaffOrdersClient({
  orders,
  restaurantId,
  userId,
  initialStatus,
  initialSearch,
}: StaffOrdersClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  const handleFilterChange = (status: string) => {
    setStatusFilter(status);
    const url = new URL(window.location.href);
    if (status === 'ALL') {
      url.searchParams.delete('status');
    } else {
      url.searchParams.set('status', status);
    }
    router.push(url.pathname + url.search);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (!searchQuery.trim()) {
      url.searchParams.delete('search');
    } else {
      url.searchParams.set('search', searchQuery.trim());
    }
    router.push(url.pathname + url.search);
  };

  return (
    <div className="space-y-6">
      {/* Controls & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => handleFilterChange(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                statusFilter === st
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'bg-[#1A2333] text-slate-400 border border-white/5 hover:border-white/10 hover:bg-white/5'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search order # or customer..."
            className="bg-[#0A0E17] border border-white/10 rounded-xl px-3.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-full sm:w-60"
          />
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-[#1A2333] hover:bg-white/10 border border-white/5 text-slate-300 text-xs font-bold rounded-xl transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Orders Grid - single col on phone, 2 on tablet for thumb reach */}
      {orders.length === 0 ? (
        <div className="bg-[#111827] border border-white/5 rounded-2xl p-10 sm:p-12 text-center space-y-3 shadow-sm">
          <div className="text-3xl sm:text-4xl">📦</div>
          <h3 className="text-base font-bold text-white">No Orders Found</h3>
          <p className="text-xs text-slate-400">
            No orders matching your filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-4">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              restaurantId={restaurantId}
              userId={userId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

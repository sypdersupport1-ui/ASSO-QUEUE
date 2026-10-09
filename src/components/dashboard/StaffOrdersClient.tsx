'use client';

import React, { useState, useTransition, useOptimistic } from 'react';
import { updateOrderStatusAction } from '@/app/dashboard/actions';
import { useRouter } from 'next/navigation';
import { chimeEngine } from '@/lib/audio-chime';

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
  restaurantName?: string;
  userId: string;
  initialStatus: string;
  initialSearch: string;
}

const STATUS_FILTERS = [
  { id: 'ALL', label: 'All Orders' },
  { id: 'PLACED', label: 'Placed' },
  { id: 'CONFIRMED', label: 'Confirmed' },
  { id: 'PREPARING', label: 'In Kitchen' },
  { id: 'READY', label: 'Ready' },
  { id: 'SERVED', label: 'Served' },
  { id: 'CANCELLED', label: 'Cancelled' },
];

type OrderStatus = 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

function getStatusBadge(status: string) {
  switch (status) {
    case 'PLACED':
      return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'CONFIRMED':
      return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
    case 'PREPARING':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30 ring-1 ring-amber-500/20';
    case 'READY':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 ring-1 ring-emerald-500/20';
    case 'SERVED':
      return 'bg-slate-800/80 text-slate-300 border-white/10';
    case 'CANCELLED':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}

function formatPrice(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatTimeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

/**
 * Individual Order Card with optimistic state, instant audio cues, and clear action pathways.
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
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(order.status);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleTransition = (targetStatus: OrderStatus) => {
    if (targetStatus === 'READY' || targetStatus === 'SERVED') {
      chimeEngine.playSeatChime();
    } else if (targetStatus === 'CANCELLED') {
      chimeEngine.playAlertChime();
    } else {
      chimeEngine.playButtonClick();
    }

    startTransition(async () => {
      setOptimisticStatus(targetStatus);
      await updateOrderStatusAction(order.id, targetStatus, restaurantId, userId);
    });
  };

  const isTerminal = optimisticStatus === 'SERVED' || optimisticStatus === 'CANCELLED';

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-2xl border bg-[#0d131f] transition-all duration-200 overflow-hidden shadow-lg ${
        optimisticStatus === 'PREPARING'
          ? 'border-amber-500/40 shadow-[0_4px_24px_rgba(245,158,11,0.1)]'
          : optimisticStatus === 'READY'
          ? 'border-emerald-500/40 shadow-[0_4px_24px_rgba(16,185,129,0.12)]'
          : isPending
          ? 'border-white/10 opacity-75 scale-[0.99]'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      {/* Top Card Banner */}
      <div className="p-4 space-y-3.5">
        {/* Header Line */}
        <div className="flex items-start justify-between gap-2 border-b border-white/5 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono font-black text-white text-base tracking-tight">
                #{order.orderNumber}
              </span>
              {order.queueDisplayNumber ? (
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
                  Q-{order.queueDisplayNumber}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-white/10 text-slate-300 font-mono text-[11px] font-medium">
                  Dine-In
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <span className="material-symbols-outlined text-[14px] text-slate-500">person</span>
              <span className="text-slate-300 font-bold">{order.customerName}</span>
              {order.customerPhone && (
                <a
                  href={`tel:${order.customerPhone}`}
                  className="ml-1 text-slate-500 hover:text-emerald-400 flex items-center gap-0.5 font-mono text-[11px]"
                  title="Call Customer"
                >
                  <span className="material-symbols-outlined text-[12px]">phone</span>
                  {order.customerPhone}
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase border ${getStatusBadge(
                optimisticStatus
              )}`}
            >
              {optimisticStatus}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {formatTimeAgo(order.createdAt)}
            </span>
          </div>
        </div>

        {/* Item Breakdown */}
        <div className="space-y-2">
          {order.items.slice(0, isExpanded ? undefined : 3).map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-2 text-xs text-slate-300 bg-white/[0.02] p-2 rounded-lg border border-white/5"
            >
              <div className="min-w-0">
                <span className="font-mono font-black text-amber-400 mr-1.5">
                  {item.quantity}×
                </span>
                <span className="font-medium text-slate-200">{item.name}</span>
                {item.notes && (
                  <div className="text-[11px] text-amber-300 font-medium mt-0.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">sticky_note_2</span>
                    <span>{item.notes}</span>
                  </div>
                )}
              </div>
              <span className="font-mono text-slate-400 text-xs shrink-0">
                {formatPrice(item.totalPrice)}
              </span>
            </div>
          ))}

          {order.items.length > 3 && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-[11px] font-bold text-slate-400 hover:text-white transition-colors w-full text-center py-1 bg-white/[0.02] rounded-md border border-white/5"
            >
              {isExpanded ? 'Show Less' : `+ ${order.items.length - 3} more items`}
            </button>
          )}
        </div>
      </div>

      {/* Footer: Payment & Actions */}
      <div className="p-4 bg-[#0a0f19] border-t border-white/5 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase font-mono border ${
                order.paymentStatus === 'PAID'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              }`}
            >
              {order.paymentStatus || 'UNPAID'}
            </span>
            <span className="text-slate-400 text-[11px] font-medium">
              {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="text-right">
            <div className="text-base font-black text-white font-mono tracking-tight">
              {formatPrice(order.total)}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="space-y-2">
          {optimisticStatus === 'PLACED' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleTransition('CONFIRMED')}
                disabled={isPending}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(79,70,229,0.3)] disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-400/30"
              >
                Confirm Order
              </button>
              <button
                type="button"
                onClick={() => handleTransition('CANCELLED')}
                disabled={isPending}
                className="px-3.5 py-2.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 font-bold text-xs rounded-xl border border-rose-500/30 transition-colors disabled:opacity-50"
                title="Cancel order"
              >
                Cancel
              </button>
            </div>
          )}

          {optimisticStatus === 'CONFIRMED' && (
            <button
              type="button"
              onClick={() => handleTransition('PREPARING')}
              disabled={isPending}
              className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(217,119,6,0.3)] disabled:opacity-50 disabled:cursor-not-allowed border border-amber-400/30 flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">skillet</span>
              Send to Kitchen
            </button>
          )}

          {optimisticStatus === 'PREPARING' && (
            <button
              type="button"
              onClick={() => handleTransition('READY')}
              disabled={isPending}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-400/30 flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">notifications_active</span>
              Mark Ready for Service
            </button>
          )}

          {optimisticStatus === 'READY' && (
            <button
              type="button"
              onClick={() => handleTransition('SERVED')}
              disabled={isPending}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-slate-100 font-black text-xs uppercase tracking-wider rounded-xl transition-all border border-white/15 flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px] text-emerald-400">check_circle</span>
              Mark Served / Closed
            </button>
          )}

          {isTerminal && (
            <div className="w-full py-2 px-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-center gap-1.5 text-xs font-bold text-slate-400">
              <span
                className={`material-symbols-outlined text-[16px] ${
                  optimisticStatus === 'SERVED' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {optimisticStatus === 'SERVED' ? 'task_alt' : 'cancel'}
              </span>
              <span>{optimisticStatus === 'SERVED' ? 'Order Fulfilled' : 'Order Cancelled'}</span>
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
  restaurantName = 'Orders Station',
  userId,
  initialStatus,
  initialSearch,
}: StaffOrdersClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

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

  const handleClearSearch = () => {
    setSearchQuery('');
    const url = new URL(window.location.href);
    url.searchParams.delete('search');
    router.push(url.pathname + url.search);
  };

  // Metrics
  const activeCount = orders.filter((o) => o.status !== 'SERVED' && o.status !== 'CANCELLED').length;
  const preparingCount = orders.filter((o) => o.status === 'PREPARING').length;
  const readyCount = orders.filter((o) => o.status === 'READY').length;
  const totalVolume = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Executive Header Bar */}
      <div className="bg-[#0b101b] border border-white/10 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Branding & Overview */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <span className="material-symbols-outlined text-2xl">table_restaurant</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                {restaurantName}
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 font-mono text-[10px] font-black tracking-widest uppercase">
                POS ORDERS
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Live Order Management, Kitchen Routing & Billing
            </p>
          </div>
        </div>

        {/* Right: Metrics Strip & View Mode Switcher */}
        <div className="flex items-center gap-3 self-start md:self-auto flex-wrap">
          <div className="px-3.5 py-1.5 rounded-xl bg-[#141b2b] border border-white/10 text-slate-200 font-mono text-xs font-bold flex items-center gap-2">
            <span className="text-slate-400">Vol:</span>
            <span className="text-emerald-400 font-black">{formatPrice(totalVolume)}</span>
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-[#141b2b] border border-white/10 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                viewMode === 'grid'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Card Grid View"
            >
              <span className="material-symbols-outlined text-[16px]">grid_view</span>
              <span className="hidden sm:inline">Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Dense Table View"
            >
              <span className="material-symbols-outlined text-[16px]">view_list</span>
              <span className="hidden sm:inline">Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Status Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-[#0d131f] border border-white/5 rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active In Service</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{activeCount}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
          </div>
        </div>

        <div className="bg-[#0d131f] border border-white/5 rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">In Kitchen</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{preparingCount}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <span className="material-symbols-outlined text-[18px]">skillet</span>
          </div>
        </div>

        <div className="bg-[#0d131f] border border-white/5 rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Ready to Serve</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{readyCount}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <span className="material-symbols-outlined text-[18px]">notifications_active</span>
          </div>
        </div>

        <div className="bg-[#0d131f] border border-white/5 rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-purple-400 uppercase tracking-wider">Total Shown</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{orders.length}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <span className="material-symbols-outlined text-[18px]">analytics</span>
          </div>
        </div>
      </div>

      {/* Filter Bar & Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#0d131f] border border-white/10 rounded-2xl p-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {STATUS_FILTERS.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => handleFilterChange(st.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                statusFilter === st.id
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-slate-500">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search # or customer..."
              className="bg-[#080d16] border border-white/10 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-full transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-[#172033] hover:bg-[#1d2942] border border-white/10 text-slate-200 text-xs font-bold rounded-xl transition-colors shrink-0"
          >
            Filter
          </button>
        </form>
      </div>

      {/* Content Rendering: Card Grid vs Table */}
      {orders.length === 0 ? (
        <div className="bg-[#0b101b] border border-white/10 rounded-2xl p-12 sm:p-20 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-white/10 mx-auto flex items-center justify-center text-slate-400">
            <span className="material-symbols-outlined text-3xl">inventory_2</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-white">No Orders Found</h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
              No orders matched your filter criteria or search query.
            </p>
          </div>
          {(statusFilter !== 'ALL' || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('ALL');
                setSearchQuery('');
                const url = new URL(window.location.href);
                url.searchParams.delete('status');
                url.searchParams.delete('search');
                router.push(url.pathname);
              }}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300 transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              restaurantId={restaurantId}
              userId={userId}
            />
          ))}
        </div>
      ) : (
        /* Dense Matrix Table View */
        <div className="bg-[#0d131f] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0a0f19] text-slate-400 uppercase tracking-wider font-mono text-[10px] border-b border-white/10">
                <tr>
                  <th className="p-3.5">Order</th>
                  <th className="p-3.5">Time</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Items</th>
                  <th className="p-3.5">Total</th>
                  <th className="p-3.5">Payment</th>
                  <th className="p-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-3.5 font-mono font-bold text-white">
                      <div className="flex items-center gap-1.5">
                        <span>#{order.orderNumber}</span>
                        {order.queueDisplayNumber && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                            Q-{order.queueDisplayNumber}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 font-mono text-slate-400">
                      {formatTimeAgo(order.createdAt)}
                    </td>
                    <td className="p-3.5 font-medium text-white">
                      {order.customerName}
                    </td>
                    <td className="p-3.5 text-slate-400">
                      {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                    </td>
                    <td className="p-3.5 font-mono font-bold text-white">
                      {formatPrice(order.total)}
                    </td>
                    <td className="p-3.5 font-mono">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          order.paymentStatus === 'PAID'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {order.paymentStatus || 'UNPAID'}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${getStatusBadge(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

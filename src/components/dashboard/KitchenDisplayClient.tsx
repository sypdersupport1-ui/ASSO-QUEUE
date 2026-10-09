'use client';

import React, { useState, useEffect, useTransition, useOptimistic } from 'react';
import { updateKitchenStatusAction } from '@/app/dashboard/actions';
import { useRouter } from 'next/navigation';
import { chimeEngine } from '@/lib/audio-chime';

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
  restaurantName?: string;
  userId: string;
}

type KitchenStatus = 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
type FilterStage = 'ALL' | 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY';

function getElapsedInfo(createdAt: string) {
  const elapsedMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const totalSecs = Math.floor(elapsedMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  
  const formatted = mins > 0 ? `${mins}m ${secs < 10 ? '0' : ''}${secs}s` : `${secs}s`;
  
  // Severity levels
  let severity: 'fresh' | 'warning' | 'critical' = 'fresh';
  if (mins >= 15) {
    severity = 'critical';
  } else if (mins >= 8) {
    severity = 'warning';
  }

  return { mins, secs, formatted, severity };
}

/**
 * Commercial-grade Kitchen Ticket Card with interactive item checklist,
 * live duration timer, and one-tap stage advancement.
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
  
  // Local checklist state so line cooks can cross off individual items as they cook
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  // Live timer tick every second for real KDS experience
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = getElapsedInfo(order.createdAt);
  // Avoid unused variable lint
  void now;

  const toggleItemCheck = (itemId: string) => {
    setCheckedItems((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      chimeEngine.playButtonClick();
      return next;
    });
  };

  const handleKitchenStatus = (targetStatus: KitchenStatus) => {
    // Sound feedback for tactile physical station
    if (targetStatus === 'READY' || targetStatus === 'SERVED') {
      chimeEngine.playSeatChime();
    } else {
      chimeEngine.playButtonClick();
    }

    startTransition(async () => {
      setOptimisticStatus(targetStatus);
      await updateKitchenStatusAction(order.id, targetStatus, restaurantId, userId);
      if (targetStatus === 'SERVED' || targetStatus === 'CANCELLED') {
        onCompleted(order.id);
      }
    });
  };

  const isAllItemsChecked = order.items.length > 0 && order.items.every((i) => checkedItems[i.id]);

  // Stage header styles
  const stageHeaderStyle = () => {
    switch (optimisticStatus) {
      case 'PLACED':
        return 'bg-blue-500/10 text-blue-400 border-b border-blue-500/20';
      case 'CONFIRMED':
        return 'bg-indigo-500/10 text-indigo-400 border-b border-indigo-500/20';
      case 'PREPARING':
        return 'bg-amber-500/10 text-amber-400 border-b border-amber-500/20';
      case 'READY':
        return 'bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20';
      default:
        return 'bg-slate-800/40 text-slate-300 border-b border-white/5';
    }
  };

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-2xl border bg-[#0d131f] transition-all duration-200 overflow-hidden shadow-lg ${
        optimisticStatus === 'PREPARING'
          ? 'border-amber-500/40 shadow-[0_4px_24px_rgba(245,158,11,0.12)]'
          : optimisticStatus === 'READY'
          ? 'border-emerald-500/40 shadow-[0_4px_24px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/20'
          : isPending
          ? 'border-white/10 opacity-75 scale-[0.99]'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      {/* Top Banner: Order # & Table/Queue Badge */}
      <div className={`px-4 py-3 flex items-center justify-between ${stageHeaderStyle()}`}>
        <div className="flex items-center gap-2">
          <span className="font-mono font-black text-white text-base tracking-tight">
            #{order.orderNumber}
          </span>
          {order.queueDisplayNumber ? (
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-black">
              Q-{order.queueDisplayNumber}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-white/10 text-slate-300 font-mono text-xs font-bold">
              Dine-In
            </span>
          )}
        </div>

        {/* Live Elapsed Timer Badge */}
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-xs font-bold ${
              elapsed.severity === 'critical'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                : elapsed.severity === 'warning'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-white/5 text-slate-300 border border-white/10'
            }`}
          >
            <span className="text-[10px]">⏱</span>
            <span>{elapsed.formatted}</span>
          </div>
        </div>
      </div>

      {/* Ticket Body */}
      <div className="p-4 space-y-4 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Customer & Info bar */}
          <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/5">
            <div className="flex items-center gap-1.5 font-medium text-slate-300 truncate max-w-[180px]">
              <span className="material-symbols-outlined text-[15px] text-slate-400">person</span>
              <span className="truncate">{order.customerName}</span>
            </div>
            <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">
              {order.items.reduce((sum, item) => sum + item.quantity, 0)} Items
            </div>
          </div>

          {/* Item Checklist (Cooks can tap items to strike them out!) */}
          <div className="space-y-2">
            {order.items.map((item) => {
              const isChecked = !!checkedItems[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItemCheck(item.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-start justify-between gap-2.5 select-none ${
                    isChecked
                      ? 'bg-emerald-950/20 border-emerald-500/30 opacity-60'
                      : 'bg-[#141c2c] border-white/5 hover:border-white/15 hover:bg-[#182338]'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <div
                      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isChecked
                          ? 'bg-emerald-500 border-emerald-400 text-black'
                          : 'border-slate-500 bg-black/40'
                      }`}
                    >
                      {isChecked && (
                        <span className="material-symbols-outlined text-[13px] font-black">check</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-xs sm:text-sm font-bold tracking-tight transition-all ${
                          isChecked ? 'line-through text-slate-400' : 'text-white'
                        }`}
                      >
                        <span className="font-mono text-amber-400 font-black mr-1.5">
                          {item.quantity}×
                        </span>
                        {item.name}
                      </div>

                      {/* Special Kitchen Notes */}
                      {item.notes && (
                        <div className="mt-1.5 flex items-start gap-1 text-[11px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1">
                          <span className="material-symbols-outlined text-[13px] text-amber-400 shrink-0 mt-0.5">
                            warning
                          </span>
                          <span className="leading-tight">{item.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Button Footer */}
        <div className="pt-3 border-t border-white/5 space-y-2">
          {optimisticStatus === 'PLACED' && (
            <button
              type="button"
              onClick={() => handleKitchenStatus('CONFIRMED')}
              disabled={isPending}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-blue-400/30"
            >
              <span className="material-symbols-outlined text-[18px]">done_all</span>
              Accept Order
            </button>
          )}

          {optimisticStatus === 'CONFIRMED' && (
            <button
              type="button"
              onClick={() => handleKitchenStatus('PREPARING')}
              disabled={isPending}
              className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_20px_rgba(217,119,6,0.35)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-amber-400/30"
            >
              <span className="material-symbols-outlined text-[18px]">skillet</span>
              Start Preparing
            </button>
          )}

          {optimisticStatus === 'PREPARING' && (
            <button
              type="button"
              onClick={() => handleKitchenStatus('READY')}
              disabled={isPending}
              className={`w-full py-3 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.35)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border ${
                isAllItemsChecked
                  ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400/40 ring-2 ring-emerald-400/30'
                  : 'bg-emerald-700/90 hover:bg-emerald-600 border-emerald-500/30'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">notifications_active</span>
              Mark Ready for Pickup
            </button>
          )}

          {optimisticStatus === 'READY' && (
            <button
              type="button"
              onClick={() => handleKitchenStatus('SERVED')}
              disabled={isPending}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-slate-100 font-black text-xs uppercase tracking-wider rounded-xl transition-all border border-white/15 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
              Mark Served / Dispatched
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function KitchenDisplayClient({
  initialOrders,
  restaurantId,
  restaurantName = 'Kitchen Station',
  userId,
}: KitchenDisplayClientProps) {
  const router = useRouter();
  const [orders, setOrders] = useState<KitchenOrderItem[]>(initialOrders);
  const [stageFilter, setStageFilter] = useState<FilterStage>('ALL');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Synchronize orders on server revalidation
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  // Live digital clock
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setCurrentTime(
        d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Polling sync (visibility-aware)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          router.refresh();
        }
      }, 15000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    start();
    document.addEventListener('visibilitychange', () =>
      document.visibilityState === 'visible' ? start() : stop()
    );
    window.addEventListener('online', start);
    window.addEventListener('offline', stop);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', start);
      window.removeEventListener('online', start);
      window.removeEventListener('offline', stop);
    };
  }, [router]);

  const handleTicketCompleted = (orderId: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      chimeEngine.playButtonClick();
    }
  };

  // Metrics
  const placedCount = orders.filter((o) => o.status === 'PLACED').length;
  const confirmedCount = orders.filter((o) => o.status === 'CONFIRMED').length;
  const preparingCount = orders.filter((o) => o.status === 'PREPARING').length;
  const readyCount = orders.filter((o) => o.status === 'READY').length;

  const filteredOrders = orders.filter((order) => {
    if (stageFilter === 'ALL') return true;
    if (stageFilter === 'PLACED') return order.status === 'PLACED';
    if (stageFilter === 'CONFIRMED') return order.status === 'CONFIRMED';
    if (stageFilter === 'PREPARING') return order.status === 'PREPARING';
    if (stageFilter === 'READY') return order.status === 'READY';
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Top Professional KDS Header Bar */}
      <div className="bg-[#0b101b] border border-white/10 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Station branding & live beacon */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <span className="material-symbols-outlined text-2xl">soup_kitchen</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                {restaurantName}
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[10px] font-black tracking-widest uppercase flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                LIVE KDS
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              FIFO Ticket Flow & Kitchen Station Terminal
            </p>
          </div>
        </div>

        {/* Right: Clock & Audio Toggle */}
        <div className="flex items-center gap-2.5 self-start md:self-auto">
          {/* Digital Clock */}
          <div className="px-3.5 py-1.5 rounded-xl bg-[#141b2b] border border-white/10 text-slate-200 font-mono text-xs font-black flex items-center gap-2 shadow-inner">
            <span className="material-symbols-outlined text-[15px] text-slate-400">schedule</span>
            <span>{currentTime || '--:--:--'}</span>
          </div>

          {/* Sound Feedback Toggle */}
          <button
            type="button"
            onClick={handleToggleSound}
            title={soundEnabled ? 'Kitchen sound enabled' : 'Kitchen sound muted'}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
              soundEnabled
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                : 'bg-slate-900 border-white/10 text-slate-500'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">
              {soundEnabled ? 'volume_up' : 'volume_off'}
            </span>
            <span className="hidden sm:inline font-mono">{soundEnabled ? 'Audio ON' : 'Muted'}</span>
          </button>
        </div>
      </div>

      {/* Stage Metric Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => setStageFilter('ALL')}
          className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
            stageFilter === 'ALL'
              ? 'bg-[#172033] border-emerald-500/40 shadow-md ring-1 ring-emerald-500/20'
              : 'bg-[#0d131f] border-white/5 hover:border-white/15'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">All Active</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{orders.length}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-300">
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStageFilter('PLACED')}
          className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
            stageFilter === 'PLACED'
              ? 'bg-[#172033] border-blue-500/40 shadow-md ring-1 ring-blue-500/20'
              : 'bg-[#0d131f] border-white/5 hover:border-white/15'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">Placed / New</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{placedCount + confirmedCount}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <span className="material-symbols-outlined text-[18px]">inbox</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStageFilter('PREPARING')}
          className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
            stageFilter === 'PREPARING'
              ? 'bg-[#172033] border-amber-500/40 shadow-md ring-1 ring-amber-500/20'
              : 'bg-[#0d131f] border-white/5 hover:border-white/15'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Preparing</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{preparingCount}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <span className="material-symbols-outlined text-[18px]">skillet</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStageFilter('READY')}
          className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
            stageFilter === 'READY'
              ? 'bg-[#172033] border-emerald-500/40 shadow-md ring-1 ring-emerald-500/20'
              : 'bg-[#0d131f] border-white/5 hover:border-white/15'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Ready / Call</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">{readyCount}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <span className="material-symbols-outlined text-[18px]">notifications_active</span>
          </div>
        </button>
      </div>

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className="bg-[#0b101b] border border-white/10 rounded-2xl p-12 sm:p-20 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mx-auto flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
            <span className="material-symbols-outlined text-3xl">task_alt</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-white">Kitchen Line Clear</h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
              {stageFilter === 'ALL'
                ? 'No active orders in the queue. New tickets will appear here with live chime audio.'
                : `No orders currently in "${stageFilter}" stage.`}
            </p>
          </div>
          {stageFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setStageFilter('ALL')}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300 transition-colors"
            >
              Show All Active Orders
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {filteredOrders.map((order) => (
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

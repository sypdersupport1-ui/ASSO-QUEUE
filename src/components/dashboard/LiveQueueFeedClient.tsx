'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { updateQueueStatusAction, markNoShowAction, completeTakeawayAction, acknowledgeTakeawayPaymentAndCompleteOrderAction, updateOrderStatusAction, createManualTakeawayOrderAction } from '@/app/dashboard/actions';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';
import { SeatCustomerModal, SeatableTableItem } from '@/components/dashboard/SeatCustomerModal';
import { StaffQueueChatModal } from '@/components/dashboard/StaffQueueChatModal';
import { AddQueueGuestModal } from '@/components/dashboard/AddQueueGuestModal';
import { StaffTakeawayOrderModal, StaffTakeawayMenuItem } from '@/components/dashboard/StaffTakeawayOrderModal';
import { chimeEngine } from '@/lib/audio-chime';

interface LiveQueueFeedClientProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialEntries: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tablesRes: { tables: any[]; stats?: any };
  userId: string;
  restaurantId?: string;
  callTimeoutMinutes?: number;
  initialStatusFilter?: string;
  initialSearchTerm?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialOrders?: any[];
  menuItems?: StaffTakeawayMenuItem[];
  currencySymbol?: string;
  takeawayManualOrderingEnabled?: boolean;
}

export function LiveQueueFeedClient({
  initialEntries,
  tablesRes,
  userId,
  restaurantId,
  callTimeoutMinutes = 15,
  initialStatusFilter = 'ACTIVE',
  initialSearchTerm = '',
  initialOrders = [],
  menuItems = [],
  currencySymbol = '₹',
  takeawayManualOrderingEnabled = false,
}: LiveQueueFeedClientProps) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [tables, setTables] = useState(tablesRes.tables || []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [orders, setOrders] = useState<any[]>(initialOrders || []);
  const [serviceFilter, setServiceFilter] = useState<'ALL' | 'DINE_IN' | 'TAKEAWAY'>('ALL');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [orderModalEntry, setOrderModalEntry] = useState<any | null>(null);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [noShowMenuId, setNoShowMenuId] = useState<string | null>(null);
  const [noShowReason, setNoShowReason] = useState('STAFF_MARKED_NO_SHOW');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [chatEntry, setChatEntry] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [searchTerm, setSearchTerm] = useState<string>(initialSearchTerm);

  // Sync state when props update
  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    if (initialOrders) setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    setTables(tablesRes.tables || []);
  }, [tablesRes.tables]);

  // Seamless polling fallback so live queue stays in lockstep across all devices
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [router]);

  // Filter tables matching party size directly from current tables state
  const availableTables = useMemo(() => {
    return tables
      .filter((t) => t.status === 'AVAILABLE')
      .map((t) => ({
        id: t.id,
        table_number: t.tableNumber,
        tableNumber: t.tableNumber,
        capacity: t.capacity,
        restaurant_zones: t.zoneName ? { name: t.zoneName } : null,
        zoneName: t.zoneName,
      })) as SeatableTableItem[];
  }, [tables]);

  // Map active orders by queueEntryId
  const ordersByQueueEntryId = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new Map<string, any>();
    orders.forEach((o) => {
      if (o.queueEntryId && o.status !== 'CANCELLED') {
        map.set(o.queueEntryId, o);
      }
    });
    return map;
  }, [orders]);

  // Filter entries based on active filter tab, service filter & search term
  const filteredEntries = useMemo(() => {
    let result = entries;

    // 1. Service Type Filter
    if (serviceFilter === 'DINE_IN') {
      result = result.filter((e) => e.queue_type !== 'TAKEAWAY');
    } else if (serviceFilter === 'TAKEAWAY') {
      result = result.filter((e) => e.queue_type === 'TAKEAWAY');
    }

    // 2. Status Filter
    if (statusFilter === 'ACTIVE') {
      result = result.filter((e) => ['WAITING', 'CALLED', 'NOTIFIED'].includes(e.status));
    } else if (statusFilter === 'WAITING') {
      result = result.filter((e) => e.status === 'WAITING');
    } else if (statusFilter === 'CALLED') {
      result = result.filter((e) => e.status === 'CALLED' || e.status === 'NOTIFIED');
    } else if (statusFilter === 'SEATED') {
      result = result.filter((e) => e.status === 'SEATED');
    } else if (statusFilter === 'TERMINAL') {
      result = result.filter((e) => ['SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'COMPLETED'].includes(e.status));
    }

    // 3. Search Filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter((e) => {
        const name = (e.customer_name || '').toLowerCase();
        const phone = (e.customer_phone || '').toLowerCase();
        const num = (e.display_number || e.queue_number || '').toString().toLowerCase();
        const order = ordersByQueueEntryId.get(e.id);
        const orderNum = (order?.orderNumber || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || num.includes(q) || orderNum.includes(q);
      });
    }

    return result;
  }, [entries, serviceFilter, statusFilter, searchTerm, ordersByQueueEntryId]);

  const handleCompleteTakeaway = async (entryId: string) => {
    setIsProcessing(entryId);
    chimeEngine.playSeatChime();

    try {
      const res = await completeTakeawayAction(entryId);
      if (!res.success) {
        alert(res.error || 'Failed to complete takeaway pickup.');
        return;
      }
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: 'COMPLETED', completed_at: new Date().toISOString() } : e))
      );
      await broadcastCustomerQueueUpdate(entryId);
    } catch (e) {
      console.error('Failed to complete takeaway order:', e);
      alert('Failed to complete takeaway order.');
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handleAcknowledgeCollection = async (entryId: string, orderId: string) => {
    setIsProcessing(entryId);
    try {
      const res = await acknowledgeTakeawayPaymentAndCompleteOrderAction(entryId, orderId);
      if (!res.success) {
        alert(res.error || 'Failed to acknowledge collection.');
      } else {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: 'PREPARING' } : o))
        );
        await broadcastCustomerQueueUpdate(entryId);
      }
    } catch (e) {
      console.error('Failed to acknowledge collection:', e);
      alert('Failed to acknowledge collection.');
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handleMarkReady = async (orderId: string, entryId: string) => {
    setIsProcessing(entryId);
    try {
      await updateOrderStatusAction(orderId, 'READY', restaurantId, userId);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'READY' } : o))
      );
      await broadcastCustomerQueueUpdate(entryId);
    } catch (e) {
      console.error('Failed to mark order ready:', e);
      alert('Failed to mark order ready.');
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handlePlaceManualOrder = async (entryId: string) => {
    setIsProcessing(entryId);
    try {
      const res = await createManualTakeawayOrderAction(entryId);
      if (!res.success) {
        alert(res.error || 'Failed to place manual order.');
      } else if (res.order) {
        setOrders((prev) => [...prev, { ...res.order, queueEntryId: entryId }]);
        await broadcastCustomerQueueUpdate(entryId);
      }
    } catch (e) {
      console.error('Failed to place manual order:', e);
      alert('Failed to place manual order.');
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  // Action Handlers with optimistic UI updates and chime sound
  const handleNotify = async (entryId: string) => {
    setIsProcessing(entryId);
    chimeEngine.playCallChime();

    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, status: 'NOTIFIED', notified_at: new Date().toISOString() } : e))
    );

    try {
      await updateQueueStatusAction(entryId, 'NOTIFIED', userId);
      await broadcastCustomerQueueUpdate(entryId);
    } catch (e) {
      console.error('Failed to notify customer:', e);
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handleCall = async (entryId: string) => {
    setIsProcessing(entryId);
    chimeEngine.playCallChime();

    setEntries((prev) => {
      const next = prev.map((e) =>
        e.id === entryId ? { ...e, status: 'CALLED', called_at: new Date().toISOString() } : e
      );
      const priority: Record<string, number> = { CALLED: 1, NOTIFIED: 2, WAITING: 3 };
      return next.sort((a, b) => {
        type EntryWithCallMeta = { call_response?: string; lateInfo?: { isLate?: boolean } };
        const anyA = a as unknown as EntryWithCallMeta;
        const anyB = b as unknown as EntryWithCallMeta;
        const isDelayedA = anyA.call_response === 'DELAY_REQUESTED' || anyA.lateInfo?.isLate;
        const isDelayedB = anyB.call_response === 'DELAY_REQUESTED' || anyB.lateInfo?.isLate;
        const isAcceptedA = a.status === 'CALLED' && anyA.call_response === 'ACCEPTED';
        const isAcceptedB = b.status === 'CALLED' && anyB.call_response === 'ACCEPTED';

        const pa = isDelayedA ? 4 : isAcceptedA ? 0 : (priority[a.status] ?? 9);
        const pb = isDelayedB ? 4 : isAcceptedB ? 0 : (priority[b.status] ?? 9);

        if (pa !== pb) return pa - pb;
        return new Date(a.joined_at || a.created_at).getTime() - new Date(b.joined_at || b.created_at).getTime();
      });
    });

    try {
      await updateQueueStatusAction(entryId, 'CALLED', userId);
      await broadcastCustomerQueueUpdate(entryId);
    } catch (e) {
      console.error('Failed to call customer:', e);
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handleNoShow = async (entryId: string, reason: string) => {
    setIsProcessing(entryId);
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    setNoShowMenuId(null);

    try {
      await markNoShowAction(entryId, reason, userId);
      await broadcastCustomerQueueUpdate(entryId);
    } catch (e) {
      console.error('Failed to mark no-show:', e);
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handleCancel = async (entryId: string) => {
    if (!confirm('Are you sure you want to cancel this guest from the queue?')) return;
    setIsProcessing(entryId);

    setEntries((prev) => prev.filter((e) => e.id !== entryId));

    try {
      await updateQueueStatusAction(entryId, 'CANCELLED', userId);
      await broadcastCustomerQueueUpdate(entryId);
    } catch (e) {
      console.error('Failed to cancel queue entry:', e);
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  // Counts for tabs
  // Counts for tabs & services
  const dineInCount = entries.filter((e) => e.queue_type !== 'TAKEAWAY').length;
  const takeawayCount = entries.filter((e) => e.queue_type === 'TAKEAWAY').length;

  const baseForCounts =
    serviceFilter === 'ALL'
      ? entries
      : serviceFilter === 'DINE_IN'
      ? entries.filter((e) => e.queue_type !== 'TAKEAWAY')
      : entries.filter((e) => e.queue_type === 'TAKEAWAY');

  const activeCount = baseForCounts.filter((e) => ['WAITING', 'CALLED', 'NOTIFIED'].includes(e.status)).length;
  const waitingCount = baseForCounts.filter((e) => e.status === 'WAITING').length;
  const calledCount = baseForCounts.filter((e) => e.status === 'CALLED' || e.status === 'NOTIFIED').length;
  const seatedCount = baseForCounts.filter((e) => e.status === 'SEATED').length;

  return (
    <div className="flex flex-col gap-4">
      {/* Search & Filter Tabs Bar */}
      <div className="flex flex-col gap-3 p-3 sm:p-4 rounded-2xl bg-[#111827]/95 border border-white/10 shadow-sm backdrop-blur-xl sticky top-0 z-40 sm:relative sm:top-auto sm:z-auto">
        <div className="relative w-full">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-[#0A0E17]/80 border border-white/10 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all font-medium"
            placeholder="Search by customer name, phone number, ticket Q-XX/T-XX, order #..."
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
            >
              Clear
            </button>
          )}
        </div>

        {/* Service Switcher (Dine-In / Takeaway / All Channels) - Enhanced, Big & Vibrant */}
        <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto hide-scrollbar py-1.5 px-0.5 border-b border-white/10">
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 mr-0.5 shrink-0 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>CHANNEL:</span>
          </span>

          {/* DINE-IN BUTTON */}
          <button
            type="button"
            onClick={() => setServiceFilter('DINE_IN')}
            className={`px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-black transition-all whitespace-nowrap shrink-0 border cursor-pointer flex items-center gap-2 active:scale-95 shadow-md ${
              serviceFilter === 'DINE_IN'
                ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white border-cyan-300 shadow-blue-500/40 ring-2 ring-cyan-400/50 scale-[1.02]'
                : 'bg-gradient-to-r from-blue-950/70 to-indigo-950/60 text-blue-200 border-blue-500/40 hover:border-cyan-400 hover:bg-blue-900/60 hover:text-white hover:shadow-blue-500/25'
            }`}
          >
            <span className="text-base sm:text-lg">🍽️</span>
            <span>Dine-In</span>
            <span
              className={`ml-0.5 px-2 py-0.5 rounded-full text-xs font-mono font-black ${
                serviceFilter === 'DINE_IN'
                  ? 'bg-white/25 text-white border border-white/40'
                  : 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
              }`}
            >
              {dineInCount}
            </span>
          </button>

          {/* TAKEAWAY BUTTON */}
          <button
            type="button"
            onClick={() => setServiceFilter('TAKEAWAY')}
            className={`px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-black transition-all whitespace-nowrap shrink-0 border cursor-pointer flex items-center gap-2 active:scale-95 shadow-md ${
              serviceFilter === 'TAKEAWAY'
                ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white border-amber-200 shadow-amber-500/40 ring-2 ring-amber-400/50 scale-[1.02]'
                : 'bg-gradient-to-r from-amber-950/70 to-orange-950/60 text-amber-200 border-amber-500/40 hover:border-amber-400 hover:bg-amber-900/60 hover:text-white hover:shadow-amber-500/25'
            }`}
          >
            <span className="text-base sm:text-lg">🛍️</span>
            <span>Takeaway</span>
            <span
              className={`ml-0.5 px-2 py-0.5 rounded-full text-xs font-mono font-black ${
                serviceFilter === 'TAKEAWAY'
                  ? 'bg-white/25 text-white border border-white/40'
                  : 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
              }`}
            >
              {takeawayCount}
            </span>
          </button>

          {/* ALL SERVICES BUTTON */}
          <button
            type="button"
            onClick={() => setServiceFilter('ALL')}
            className={`px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-xs sm:text-xs font-extrabold transition-all whitespace-nowrap shrink-0 border cursor-pointer flex items-center gap-1.5 active:scale-95 ${
              serviceFilter === 'ALL'
                ? 'bg-white/20 text-white border-white/30 shadow-md ring-1 ring-white/30'
                : 'bg-white/[0.04] text-slate-300 border-white/10 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            <span>All Channels</span>
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/10 text-slate-300 text-[11px] font-mono">
              {entries.length}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 overflow-x-auto hide-scrollbar pb-0.5">
          <div className="flex items-center gap-1.5 shrink-0">
            {[
              { label: `Active (${activeCount})`, value: 'ACTIVE' },
              { label: `Waiting (${waitingCount})`, value: 'WAITING' },
              { label: `Called (${calledCount})`, value: 'CALLED' },
              { label: `Dining (${seatedCount})`, value: 'SEATED' },
              { label: 'History', value: 'TERMINAL' },
              { label: `All (${entries.length})`, value: 'ALL' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0 border cursor-pointer ${
                  statusFilter === tab.value
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-blue-500 shadow-md shadow-blue-500/25'
                    : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="shrink-0 hidden sm:block">
            <AddQueueGuestModal
              label="Add Walk-In (+)"
              icon="person_add"
              triggerClassName="px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:brightness-110 active:scale-95 text-white text-xs font-black shadow-md shadow-blue-500/25 transition-all flex items-center gap-1.5 cursor-pointer border border-blue-400/30 shrink-0"
            />
          </div>
        </div>
      </div>

      {/* Queue Feed Stream Cards */}
      <div className="flex flex-col gap-3.5">
        {filteredEntries.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#111827]/90 via-[#0C121E]/80 to-[#070B14] p-10 sm:p-14 text-center flex flex-col items-center justify-center shadow-xl relative overflow-hidden">
            {/* Ambient radial glow */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.12)_0%,transparent_70%)] pointer-events-none" />

            {/* Pulsing Radar Ring Icon */}
            <div className="relative mb-5 flex items-center justify-center">
              <div className="w-20 h-20 rounded-full border border-blue-500/30 bg-blue-500/10 flex items-center justify-center relative shadow-inner">
                <div className="absolute inset-0 rounded-full border border-blue-400/40 animate-ping opacity-30" />
                <span className="material-symbols-outlined text-4xl text-blue-400">sensors</span>
              </div>
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {searchTerm ? 'No Matching Guests Found' : 'Queue Flow is Clear & Ready'}
            </h3>
            <p className="text-slate-400 text-xs sm:text-sm mt-1.5 max-w-md leading-relaxed">
              {searchTerm
                ? `No guests match "${searchTerm}". Check the spelling or search by ticket number.`
                : 'All waiting parties have been seated or paged. Host stand is ready to intake new walk-ins.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 relative z-10">
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-black transition-all cursor-pointer border border-white/10"
                >
                  Clear Search Filter
                </button>
              ) : (
                <AddQueueGuestModal
                  label="Add Walk-In Guest to Queue"
                  icon="person_add"
                  triggerClassName="px-6 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-95 text-white font-black text-sm shadow-xl shadow-blue-500/30 transition-all flex items-center gap-2 cursor-pointer border border-blue-400/40"
                />
              )}
            </div>
          </div>
        ) : (
          filteredEntries.map((entry, index) => {
            const isWaiting = entry.status === 'WAITING';
            const isCalled = entry.status === 'CALLED';
            const isNotified = entry.status === 'NOTIFIED';
            const isSeated = entry.status === 'SEATED';
            const isNext = isWaiting && index === 0;
            const isLargeGroup = (entry.party_size || 0) >= 6;
            const loading = isProcessing === entry.id;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyEntry = entry as any;
            const isTakeaway = entry.queue_type === 'TAKEAWAY';
            const linkedOrder = ordersByQueueEntryId.get(entry.id);
            const isVIP = anyEntry.is_vip || false;
            const hasPreOrder = anyEntry.pre_order_amount && anyEntry.pre_order_amount > 0;

            const seatableForParty = availableTables.filter((t) => (t.capacity || 0) >= entry.party_size);

            // Theme styling per status
            const cardTheme = isTakeaway
              ? isCalled
                ? {
                    container:
                      'bg-gradient-to-r from-amber-950/40 via-[#0F172A] to-[#0A0F1D] border-amber-500/35 shadow-[0_0_25px_rgba(245,158,11,0.12)]',
                    accentLine:
                      'bg-gradient-to-b from-amber-400 via-orange-500 to-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.8)]',
                    ticketBox:
                      'bg-gradient-to-br from-amber-600 to-orange-700 text-white shadow-lg shadow-orange-500/30 border border-orange-400/40',
                    badge: 'bg-amber-500/20 border-amber-400/40 text-amber-300 font-bold',
                  }
                : {
                    container:
                      'bg-[#111827] hover:bg-[#141E30] border-amber-500/20 hover:border-amber-500/40 shadow-md',
                    accentLine: 'bg-amber-600/70',
                    ticketBox: 'bg-[#1E293B] border border-amber-500/30 text-amber-200 shadow-sm',
                    badge: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
                  }
              : isCalled
              ? {
                  container:
                    'bg-gradient-to-r from-blue-950/40 via-[#0F172A] to-[#0A0F1D] border-blue-500/35 shadow-[0_0_25px_rgba(59,130,246,0.12)]',
                  accentLine:
                    'bg-gradient-to-b from-blue-400 via-blue-500 to-indigo-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]',
                  ticketBox:
                    'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/30 border border-blue-400/40',
                  badge: 'bg-blue-500/20 border-blue-400/40 text-blue-300 font-bold',
                }
              : isNotified
              ? {
                  container:
                    'bg-gradient-to-r from-purple-950/40 via-[#0F172A] to-[#0A0F1D] border-purple-500/35 shadow-[0_0_25px_rgba(168,85,247,0.12)]',
                  accentLine:
                    'bg-gradient-to-b from-purple-400 via-purple-500 to-pink-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]',
                  ticketBox:
                    'bg-gradient-to-br from-purple-600 to-pink-700 text-white shadow-lg shadow-purple-500/30 border border-purple-400/40',
                  badge: 'bg-purple-500/20 border-purple-400/40 text-purple-300 font-bold',
                }
              : isSeated
              ? {
                  container:
                    'bg-gradient-to-r from-emerald-950/40 via-[#0F172A] to-[#0A0F1D] border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.12)]',
                  accentLine:
                    'bg-gradient-to-b from-emerald-400 to-teal-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]',
                  ticketBox:
                    'bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-500/30 border border-emerald-400/40',
                  badge: 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300 font-bold',
                }
              : isNext
              ? {
                  container:
                    'bg-gradient-to-r from-cyan-950/40 via-[#0F172A] to-[#0A0F1D] border-cyan-500/35 shadow-[0_0_20px_rgba(6,182,212,0.12)]',
                  accentLine: 'bg-gradient-to-b from-cyan-400 to-blue-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]',
                  ticketBox:
                    'bg-gradient-to-br from-cyan-900/60 to-blue-900/80 text-cyan-300 shadow-md border border-cyan-500/40',
                  badge: 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300 font-bold',
                }
              : {
                  container: 'bg-[#111827] hover:bg-[#141E30] border-white/10 hover:border-white/20 shadow-md',
                  accentLine: 'bg-slate-700',
                  ticketBox: 'bg-[#1E293B] border border-white/10 text-slate-200 shadow-sm',
                  badge: 'bg-white/5 border-white/10 text-slate-300',
                };

            const rawNum = (entry.display_number || entry.queue_number || '').toString();
            const cleanNum = isTakeaway
              ? rawNum.startsWith('T-')
                ? rawNum
                : `T-${rawNum.replace(/^#+/, '')}`
              : rawNum.startsWith('Q-')
              ? rawNum
              : `Q-${rawNum.replace(/^#+/, '')}`;

            const joinedTimestamp = new Date(entry.joined_at || entry.created_at).getTime();
            const waitMins = Math.max(0, Math.floor((Date.now() - joinedTimestamp) / 60000));

            return (
              <div
                key={entry.id}
                className={`relative overflow-hidden rounded-2xl p-3 sm:p-4 transition-all duration-300 group ${
                  cardTheme.container
                } ${loading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {/* Glowing status indicator ribbon on left */}
                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${cardTheme.accentLine}`} />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pl-1.5">
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* Visual Ticket Monospace Card */}
                    <div
                      className={`flex flex-col items-center justify-center w-15 h-15 sm:w-17 sm:h-17 rounded-2xl shrink-0 transition-transform group-hover:scale-105 ${cardTheme.ticketBox}`}
                    >
                      <span className="font-mono font-black text-xl sm:text-2xl tracking-tight leading-none">
                        {cleanNum}
                      </span>
                      <span className="text-[8px] uppercase tracking-widest font-black mt-1 px-1 rounded">
                        {isTakeaway
                          ? isCalled
                            ? 'READY'
                            : 'TAKEAWAY'
                          : isSeated
                          ? 'DINING'
                          : isCalled
                          ? 'PRIORITY'
                          : isNotified
                          ? 'ARRIVING'
                          : isNext
                          ? 'UP NEXT'
                          : `#${index + 1} IN LINE`}
                      </span>
                    </div>

                    {/* Guest Profile & Metadata */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base sm:text-lg font-black text-white tracking-tight truncate">
                          {entry.customer_name}
                        </span>
                        {isVIP && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-black border border-amber-500/30 shrink-0">
                            <span>⭐</span> VIP
                          </span>
                        )}
                        {!isTakeaway && isLargeGroup && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 text-[10px] font-black border border-orange-500/30 shrink-0">
                            <span>🔥</span> Large Group
                          </span>
                        )}
                      </div>

                      {/* Contact & Service details */}
                      {isTakeaway ? (
                        <div className="flex items-center gap-2 mt-0.5 text-xs sm:text-[13px] text-slate-300 flex-wrap">
                          <span className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/25 to-orange-500/20 text-amber-300 border border-amber-400/50 text-[11px] font-black uppercase tracking-wider shadow-sm shadow-amber-500/15 flex items-center gap-1">
                            <span>🛍️</span>
                            <span>TAKEAWAY</span>
                          </span>
                          {entry.customer_phone ? (
                            <>
                              <span className="text-slate-600">•</span>
                              <a
                                href={`tel:${entry.customer_phone}`}
                                className="font-mono text-xs text-slate-400 hover:text-blue-400 hover:underline flex items-center gap-1"
                              >
                                <span>📞</span> {entry.customer_phone}
                              </a>
                            </>
                          ) : (
                            <span className="text-slate-500 text-xs">• No phone</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-0.5 text-xs sm:text-[13px] text-slate-300 flex-wrap">
                          <span className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-500/25 to-cyan-500/20 text-blue-300 border border-blue-400/50 text-[11px] font-black uppercase tracking-wider shadow-sm shadow-blue-500/15 flex items-center gap-1">
                            <span>🍽️</span>
                            <span>DINE-IN</span>
                          </span>
                          <span className="font-semibold text-slate-200">
                            👥 {entry.party_size} {entry.party_size === 1 ? 'guest' : 'guests'}
                          </span>
                          <span className="text-slate-600">•</span>
                          {entry.customer_phone ? (
                            <a
                              href={`tel:${entry.customer_phone}`}
                              className="font-mono text-xs text-slate-400 hover:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <span>📞</span> {entry.customer_phone}
                            </a>
                          ) : (
                            <span className="text-slate-500 text-xs">No phone</span>
                          )}
                        </div>
                      )}

                      {/* Time & State Pills */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/[0.04] border border-white/5 text-[11px] text-slate-400 font-medium">
                          <span>⏳</span> Waited {waitMins}m
                        </span>

                        {isCalled && entry.called_at && (
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${(() => {
                              const age = Date.now() - new Date(entry.called_at).getTime();
                              const timeoutMs = callTimeoutMinutes * 60 * 1000;
                              const remaining = timeoutMs - age;
                              if (remaining <= 0) return 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse';
                              if (remaining <= 2 * 60 * 1000)
                                return 'bg-amber-500/20 border-amber-500/40 text-amber-300';
                              return 'bg-blue-500/20 border-blue-500/40 text-blue-300';
                            })()}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
                            {(() => {
                              const ageMins = Math.floor((Date.now() - new Date(entry.called_at).getTime()) / 60000);
                              const remaining = callTimeoutMinutes - ageMins;
                              if (remaining <= 0) return `Overdue by ${Math.abs(remaining)}m`;
                              if (remaining <= 2) return `Timeout in ${remaining}m!`;
                              return `Called ${ageMins}m ago (${remaining}m left)`;
                            })()}
                          </span>
                        )}

                        <span
                          className={`px-2.5 py-0.5 rounded-full border text-[10px] uppercase tracking-widest font-black shrink-0 ${cardTheme.badge}`}
                        >
                          {entry.status}
                        </span>
                      </div>

                      {/* Takeaway Order Breakdown Pill */}
                      {isTakeaway && (
                        <div className="mt-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex flex-col gap-1">
                          {linkedOrder ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-white">Order #{linkedOrder.orderNumber}</span>
                                  <span className="text-slate-400 text-[11px]">
                                    ({linkedOrder.itemCount} {linkedOrder.itemCount === 1 ? 'item' : 'items'})
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                      linkedOrder.status === 'READY'
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                        : linkedOrder.status === 'PREPARING'
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                    }`}
                                  >
                                    {linkedOrder.status}
                                  </span>
                                  <span className="font-mono font-black text-amber-400 text-xs">
                                    {currencySymbol}
                                    {Number(linkedOrder.total).toFixed(2)}
                                  </span>
                                </div>
                              </div>
                              {linkedOrder.items && linkedOrder.items.length > 0 && (
                                <div className="text-[11px] text-slate-400 truncate">
                                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                  {linkedOrder.items.map((i: any) => `${i.name} × ${i.quantity}`).join(' · ')}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 text-xs">
                              {takeawayManualOrderingEnabled ? (
                                <span className="text-amber-300/80 font-medium text-[11px] flex items-center gap-1">
                                  <span>📝</span>
                                  <span>Manual Counter Ordering</span>
                                </span>
                              ) : (
                                <>
                                  <span className="text-slate-400 italic text-[11px]">No order attached yet</span>
                                  <button
                                    type="button"
                                    onClick={() => setOrderModalEntry(entry)}
                                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1"
                                  >
                                    <span>+ Take Order</span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Customer Late Alert Banner (Dine-in only) */}
                      {!isTakeaway && entry.lateInfo?.isLate && (
                        <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs">
                          <span className="material-symbols-outlined text-[15px] text-amber-400">schedule</span>
                          <span className="font-bold">Running Late (+{entry.lateInfo.delayMinutes || 10}m)</span>
                          {entry.lateInfo.note && (
                            <span className="text-[11px] text-amber-200/90 truncate">
                              · &ldquo;{entry.lateInfo.note}&rdquo;
                            </span>
                          )}
                          {entry.lateInfo.tablePassedToNext && (
                            <span className="ml-auto text-[9px] font-black uppercase px-2 py-0.5 rounded bg-purple-500/30 text-purple-200 border border-purple-500/40 shrink-0">
                              Table Passed · Spot Held
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Highlight on Right */}
                  <div className="flex items-center sm:flex-col sm:items-end justify-between shrink-0">
                    {isTakeaway ? (
                      isCalled ? (
                        anyEntry.call_response === 'ACCEPTED' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            ✅ AT COUNTER
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                            CALLING FOR PICKUP
                          </span>
                        )
                      ) : isWaiting ? (
                        <span
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] tracking-widest uppercase font-bold border ${
                            isNext
                              ? 'bg-amber-500/20 border-amber-400/40 text-amber-300 font-black'
                              : 'bg-white/5 border-white/10 text-slate-400'
                          }`}
                        >
                          {isNext ? '⚡ NEXT FOR PICKUP' : 'IN QUEUE'}
                        </span>
                      ) : null
                    ) : (
                      <>
                        {isNotified && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                            NOTIFIED
                          </span>
                        )}
                        {isCalled && (
                          (() => {
                            const response = anyEntry.call_response;
                            const delayMins = anyEntry.call_delay_minutes || 10;
                            const age = entry.called_at ? Date.now() - new Date(entry.called_at).getTime() : 0;
                            const timeoutMs = callTimeoutMinutes * 60 * 1000;
                            const isOverdue = timeoutMs - age <= 0;

                            if (response === 'ACCEPTED') {
                              return (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                  CALLED · ON THE WAY
                                </span>
                              );
                            }
                            if (response === 'DELAY_REQUESTED') {
                              return (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                                  CALLED · DELAY (+{delayMins}m)
                                </span>
                              );
                            }
                            if (isOverdue) {
                              return (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                                  CALLED · EXPIRED
                                </span>
                              );
                            }
                            return (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/40 text-blue-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                                CALLED · AWAITING RESPONSE
                              </span>
                            );
                          })()
                        )}
                        {isWaiting && (
                          <span
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] tracking-widest uppercase font-bold border ${
                              isNext
                                ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300 font-black'
                                : 'bg-white/5 border-white/10 text-slate-400'
                            }`}
                          >
                            {isNext ? '⚡ NEXT TO CALL' : 'WAITING'}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* ACTION RIBBON: High-Visibility, Tactile Staff Action Bar */}
                <div className="flex flex-col gap-2.5 pt-3 border-t border-white/10 -mx-4 -mb-4 px-4 py-3 rounded-b-2xl bg-[#080D1A]/60">
                  {isTakeaway ? (
                    /* TAKEAWAY ACTION BAR: Zero table/seating UI */
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-end gap-2 w-full items-center">
                      {isWaiting && (
                        <>
                          {!linkedOrder && (
                            <button
                              type="button"
                              onClick={() => setOrderModalEntry(entry)}
                              className="col-span-1 px-4 h-11 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold transition-all cursor-pointer border border-amber-500/40 flex items-center justify-center gap-1.5"
                            >
                              <span>🛍️</span>
                              <span>Take Order</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCall(entry.id)}
                            disabled={loading}
                            className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:brightness-110 active:scale-95 text-slate-950 text-sm font-black shadow-lg shadow-orange-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>📢</span>
                            <span>Call for Pickup</span>
                          </button>
                        </>
                      )}

                      {isCalled && (
                        <>
                          {!linkedOrder && (
                            <>
                              {takeawayManualOrderingEnabled ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handlePlaceManualOrder(entry.id)}
                                    disabled={loading}
                                    className="col-span-1 px-4 h-11 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:brightness-110 active:scale-95 text-white text-xs font-black shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                  >
                                    <span>📝</span>
                                    <span>Place Order</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteTakeaway(entry.id)}
                                    disabled={loading}
                                    className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:brightness-110 active:scale-95 text-white text-sm font-black shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                                  >
                                    <span>✓</span>
                                    <span>Items Received</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setOrderModalEntry(entry)}
                                    className="col-span-1 px-4 h-11 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold transition-all cursor-pointer border border-amber-500/40 flex items-center justify-center gap-1.5"
                                  >
                                    <span>🛍️</span>
                                    <span>+ Take Order</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteTakeaway(entry.id)}
                                    disabled={loading}
                                    className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:brightness-110 active:scale-95 text-white text-sm font-black shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                                  >
                                    <span>✓</span>
                                    <span>Items Received</span>
                                  </button>
                                </>
                              )}
                            </>
                          )}

                          {linkedOrder && (
                            <>
                              {/* Step A: Order is PLACED or CONFIRMED -> Staff acknowledges collection */}
                              {['PLACED', 'CONFIRMED'].includes(linkedOrder.status) && (
                                <button
                                  type="button"
                                  onClick={() => handleAcknowledgeCollection(entry.id, linkedOrder.id)}
                                  disabled={loading}
                                  className="col-span-2 sm:col-span-1 px-4 h-11 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 active:scale-95 text-white text-xs font-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                  <span>💵</span>
                                  <span>Acknowledge Collection &amp; Start Prep</span>
                                </button>
                              )}

                              {/* Step B: Order is PREPARING -> Kitchen cooking. RULE 1: ITEMS RECEIVED MUST NOT BE AVAILABLE WHILE PREPARING */}
                              {linkedOrder.status === 'PREPARING' && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold">
                                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                    <span>Preparing Food</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkReady(linkedOrder.id, entry.id)}
                                    disabled={loading}
                                    className="px-4 h-11 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:brightness-110 active:scale-95 text-white text-xs font-black shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                  >
                                    <span>🔔</span>
                                    <span>Mark Ready for Pickup</span>
                                  </button>
                                </div>
                              )}

                              {/* Step C: Order is READY -> Items received becomes available! */}
                              {linkedOrder.status === 'READY' && (
                                <button
                                  type="button"
                                  onClick={() => handleCompleteTakeaway(entry.id)}
                                  disabled={loading}
                                  className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:brightness-110 active:scale-95 text-white text-sm font-black shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                                >
                                  <span>✓</span>
                                  <span>Items Received</span>
                                </button>
                              )}
                            </>
                          )}
                        </>
                      )}

                      {/* Cancel Takeaway button */}
                      <button
                        type="button"
                        onClick={() => handleCancel(entry.id)}
                        disabled={loading}
                        className="h-11 w-11 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/5 hover:border-rose-500/30 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                        title="Cancel Takeaway Entry"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  ) : (
                    /* DINE-IN ACTION BAR: Preserved completely */
                    <>
                      {(isCalled || hasPreOrder || anyEntry.notes) && (
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          {isCalled && (
                            (() => {
                              const resp = anyEntry.call_response;
                              if (resp === 'ACCEPTED') {
                                return (
                                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Guest confirmed — on their way
                                  </span>
                                );
                              }
                              if (resp === 'DELAY_REQUESTED') {
                                return (
                                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-bold">
                                    <span className="w-2 h-2 rounded-full bg-amber-400" /> Delay requested (+{anyEntry.call_delay_minutes || 10}m)
                                  </span>
                                );
                              }
                              return (
                                <span className="inline-flex items-center gap-1.5 text-blue-400 font-medium">
                                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" /> Awaiting guest response
                                </span>
                              );
                            })()
                          )}
                          {hasPreOrder && (
                            <span className="text-amber-300 font-semibold flex items-center gap-1">
                              <span>🍽️</span> Dishes Pre-Ordered
                            </span>
                          )}
                          {anyEntry.notes && (
                            <span className="text-slate-400 truncate">Note: {anyEntry.notes}</span>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-end gap-2 w-full items-center">
                        {/* Step 1: WAITING -> Notify */}
                        {isWaiting && (
                          <button
                            type="button"
                            onClick={() => handleNotify(entry.id)}
                            disabled={loading}
                            className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-95 text-white text-sm font-black shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>🔔</span>
                            <span>Notify Guest</span>
                          </button>
                        )}

                        {/* Step 2: NOTIFIED -> Call */}
                        {isNotified && (
                          <button
                            type="button"
                            onClick={() => handleCall(entry.id)}
                            disabled={loading}
                            className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 hover:brightness-110 active:scale-95 text-white text-sm font-black shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>📢</span>
                            <span>Call — Table Ready</span>
                          </button>
                        )}

                        {/* Step 3: CALLED -> Assign Table & Seat (Gated on guest acceptance) */}
                        {isCalled && (
                          <div className="col-span-2 sm:col-span-1 flex flex-col gap-1">
                            {anyEntry.call_response === 'ACCEPTED' ? (
                              <SeatCustomerModal
                                entryId={entry.id}
                                customerName={entry.customer_name}
                                displayNumber={entry.display_number}
                                partySize={entry.party_size}
                                userId={userId || ''}
                                seatableTables={seatableForParty}
                                allAvailableTables={availableTables}
                                triggerLabel="Assign Table & Seat"
                                triggerClassName="w-full h-11 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-emerald-950/40 transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
                                onSeated={async (tableId, additionalIds) => {
                                  chimeEngine.playSeatChime();
                                  setEntries((prev) => prev.filter((e) => e.id !== entry.id));
                                  const allIds = [tableId, ...(additionalIds || [])];
                                  setTables((prev) =>
                                    prev.map((t) => (allIds.includes(t.id) ? { ...t, status: 'OCCUPIED' } : t))
                                  );
                                  await broadcastCustomerQueueUpdate(entry.id);
                                  router.refresh();
                                }}
                              />
                            ) : (
                              <>
                                <div
                                  title="Guest must accept the table call on their phone before a table can be assigned."
                                  className="w-full h-11 px-3 rounded-xl bg-slate-800/80 border border-white/10 text-slate-400 text-xs font-bold opacity-80 cursor-not-allowed flex items-center justify-center gap-1.5 select-none"
                                >
                                  {anyEntry.call_response === 'DELAY_REQUESTED' ? (
                                    <>
                                      <span>⏱</span>
                                      <span>Guest Delayed (+{anyEntry.call_delay_minutes || 10}m)</span>
                                    </>
                                  ) : anyEntry.call_response === 'DECLINED' ? (
                                    <>
                                      <span className="text-rose-400">✕</span>
                                      <span className="text-rose-300">Guest Declined Table</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                                      <span>Awaiting Guest Acceptance</span>
                                    </>
                                  )}
                                </div>
                                {anyEntry.call_response !== 'DECLINED' && (
                                  <SeatCustomerModal
                                    entryId={entry.id}
                                    customerName={entry.customer_name}
                                    displayNumber={entry.display_number}
                                    partySize={entry.party_size}
                                    userId={userId || ''}
                                    seatableTables={seatableForParty}
                                    allAvailableTables={availableTables}
                                    triggerLabel="⚡ Seat in Person (Override)"
                                    triggerClassName="text-[10px] text-slate-400 hover:text-emerald-300 font-semibold text-center transition-colors cursor-pointer block w-full py-0.5"
                                    onSeated={async (tableId, additionalIds) => {
                                      chimeEngine.playSeatChime();
                                      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
                                      const allIds = [tableId, ...(additionalIds || [])];
                                      setTables((prev) =>
                                        prev.map((t) => (allIds.includes(t.id) ? { ...t, status: 'OCCUPIED' } : t))
                                      );
                                      await broadcastCustomerQueueUpdate(entry.id);
                                      router.refresh();
                                    }}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Step 3: CALLED -> Remove / No-Show / Cancel */}
                        {isCalled && (
                          <div className="col-span-2 sm:col-span-1 flex items-center gap-1 relative">
                            {noShowMenuId === entry.id ? (
                              <div className="flex items-center gap-1 w-full animate-in fade-in">
                                <select
                                  value={noShowReason}
                                  onChange={(e) => setNoShowReason(e.target.value)}
                                  className="flex-1 min-w-0 h-11 rounded-xl bg-[#1A2333] border border-white/10 text-slate-200 text-xs font-bold px-2"
                                >
                                  <option value="CUSTOMER_DECLINED">Customer Can&apos;t Come / Declined</option>
                                  <option value="STAFF_MARKED_NO_SHOW">Staff marked No-Show</option>
                                  <option value="CUSTOMER_DID_NOT_RETURN">Did not return</option>
                                  <option value="CUSTOMER_DID_NOT_RESPOND">No response</option>
                                  <option value="OTHER">Other</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleNoShow(entry.id, noShowReason)}
                                  className="px-3 h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shrink-0 transition-colors cursor-pointer"
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNoShowMenuId(null)}
                                  className="px-2 h-11 rounded-xl bg-white/5 text-slate-400 hover:text-white text-xs"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : anyEntry.call_response === 'DECLINED' ? (
                              <button
                                type="button"
                                onClick={() => handleNoShow(entry.id, 'CUSTOMER_DECLINED')}
                                className="w-full sm:w-auto px-4 h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                              >
                                <span>✕</span> Remove Declined Guest
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setNoShowMenuId(entry.id)}
                                className="w-full sm:w-auto px-4 h-11 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold transition-colors cursor-pointer"
                              >
                                Remove / No-Show
                              </button>
                            )}
                          </div>
                        )}

                        {/* Chat with Customer button */}
                        <button
                          type="button"
                          onClick={() => setChatEntry(entry)}
                          className="h-11 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/10 flex items-center justify-center gap-1.5 text-xs font-bold transition-colors cursor-pointer"
                          title="Chat with customer"
                        >
                          <span className="material-symbols-outlined text-[17px] text-cyan-400">chat</span>
                          <span className="hidden sm:inline">Chat</span>
                          {entry.chatMessages && entry.chatMessages.length > 0 && (
                            <span className="h-4 min-w-4 px-1 rounded-full bg-cyan-500 text-slate-950 text-[9px] font-black flex items-center justify-center">
                              {entry.chatMessages.length}
                            </span>
                          )}
                        </button>

                        {/* Cancel Entry button */}
                        {(isWaiting || isNotified || isCalled) && (
                          <button
                            type="button"
                            onClick={() => handleCancel(entry.id)}
                            disabled={loading}
                            className="h-11 w-11 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/5 hover:border-rose-500/30 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                            title="Cancel Entry"
                          >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Staff Takeaway Order Modal */}
      {orderModalEntry && (
        <StaffTakeawayOrderModal
          isOpen={!!orderModalEntry}
          onClose={() => setOrderModalEntry(null)}
          queueEntry={orderModalEntry}
          menuItems={menuItems}
          currencySymbol={currencySymbol}
          onOrderCreated={(newOrder) => {
            setOrders((prev) => [...prev, { ...newOrder, queueEntryId: orderModalEntry.id }]);
            router.refresh();
          }}
        />
      )}

      {/* Staff Queue Chat Modal */}
      {chatEntry && (
        <StaffQueueChatModal
          isOpen={!!chatEntry}
          onClose={() => setChatEntry(null)}
          queueEntryId={chatEntry.id}
          customerName={chatEntry.customer_name}
          ticketDisplayNumber={
            chatEntry.display_number
              ? `Q-${chatEntry.display_number}`
              : `Q-${String(chatEntry.id || '').slice(0, 4).toUpperCase()}`
          }
          lateInfo={chatEntry.lateInfo}
          initialMessages={chatEntry.chatMessages || []}
          onActionComplete={() => {
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

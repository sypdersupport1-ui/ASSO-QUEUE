'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateQueueStatusAction, updateTableStatusAction, markNoShowAction, passTableToNextAction, completeTakeawayAction } from '@/app/dashboard/actions';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';
import { SeatCustomerModal, SeatableTableItem } from '@/components/dashboard/SeatCustomerModal';
import { StaffQueueChatModal } from '@/components/dashboard/StaffQueueChatModal';
import { chimeEngine } from '@/lib/audio-chime';
import type { TableStatus } from '@/types/database.types';

interface DashboardClientProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feedEntries: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tablesRes: { tables: any[] };
  activeQueueCount: number;
  userId?: string;
  callTimeoutMinutes?: number;
}

export function DashboardClient({
  feedEntries,
  tablesRes,
  activeQueueCount,
  userId,
  callTimeoutMinutes = 15,
}: DashboardClientProps) {
  const router = useRouter();
  const [feed, setFeed] = useState(feedEntries);
  const [tables, setTables] = useState(tablesRes.tables);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [noShowMenuId, setNoShowMenuId] = useState<string | null>(null);
  const [noShowReason, setNoShowReason] = useState('STAFF_MARKED_NO_SHOW');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [chatEntry, setChatEntry] = useState<any | null>(null);

  // Sync state when props update from server
  useEffect(() => {
    setFeed(feedEntries);
  }, [feedEntries]);

  useEffect(() => {
    setTables(tablesRes.tables);
  }, [tablesRes.tables]);

  // Seamless polling fallback so dashboard stays strictly synchronized with other screens
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [router]);

  // Sync triggers for customer realtime notifications:
  // - notified: broadcastCustomerQueueUpdate(entryId)
  // - no-show: broadcastCustomerQueueUpdate(entryId)
  const handleNotify = async (entryId: string) => {
    setIsProcessing(entryId);
    chimeEngine.playCallChime();

    // Optimistic UI update: instantly elevate entry to NOTIFIED
    setFeed((prev) =>
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

    // Optimistic UI update: instantly elevate entry to CALLED and resort to top priority
    setFeed((prev) => {
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

  const handlePassToNext = async (entryId: string) => {
    setIsProcessing(entryId);
    try {
      await passTableToNextAction(entryId);
      await broadcastCustomerQueueUpdate(entryId);
      chimeEngine.playAlertChime();
      router.refresh();
    } catch (e) {
      console.error('Failed to pass table:', e);
      alert('Could not pass table to next customer.');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleNoShow = async (entryId: string, reason: string) => {
    setIsProcessing(entryId);
    setNoShowMenuId(null);

    // Optimistic UI update: remove from active queue
    setFeed((prev) => prev.filter((e) => e.id !== entryId));

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

    // Optimistic UI update: instantly remove from feed
    setFeed((prev) => prev.filter((e) => e.id !== entryId));

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

  const handleTableStatus = async (tableId: string, targetStatus: TableStatus, currentStatus?: TableStatus) => {
    setIsProcessing(`table-${tableId}`);
    // Optimistic UI update: table status immediately flips
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, status: targetStatus } : t)));

    try {
      await updateTableStatusAction(tableId, targetStatus, currentStatus);
    } catch (e) {
      console.error('Failed to update table status:', e);
    } finally {
      setIsProcessing(null);
      router.refresh();
    }
  };

  const handlePingBusser = async (tableId: string) => {
    await handleTableStatus(tableId, 'AVAILABLE', 'CLEANING');
  };

  // Pre-calculate seatable tables for each entry
  const availableTables = tables
    .filter((t) => t.status === 'AVAILABLE')
    .map((t) => ({
      id: t.id,
      table_number: t.tableNumber,
      tableNumber: t.tableNumber,
      capacity: t.capacity,
      restaurant_zones: t.zoneName ? { name: t.zoneName } : null,
      zoneName: t.zoneName,
    })) as SeatableTableItem[];
  const tablesTotal = tables.length;
  const tablesOccupied = tables.filter((t) => t.status === 'OCCUPIED').length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 lg:gap-8 items-start relative z-10">
      {/* LEFT COLUMN: Queue Feed matching Live Queue page design */}
      <section className="lg:col-span-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">Live Queue Feed</h2>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs text-slate-400 font-mono">Real-time Stream</span>
          </div>
          <Link
            href="/dashboard/queue"
            className="text-sm font-bold text-primary hover:text-blue-400 transition-colors flex items-center gap-1"
          >
            View All {activeQueueCount} <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </Link>
        </div>

        <div className="flex flex-col gap-4">
          {feed.length === 0 ? (
            <div className="bg-[#111827] rounded-2xl border border-white/5 p-10 text-center flex flex-col items-center shadow-sm">
              <span className="material-symbols-outlined text-4xl text-slate-600 mb-2">inbox</span>
              <p className="text-slate-400">The queue is currently empty.</p>
            </div>
          ) : (
            feed.map((entry, index) => {
              const isTakeaway = entry.queue_type === 'TAKEAWAY';
              const isWaiting = entry.status === 'WAITING';
              const isCalled = entry.status === 'CALLED';
              const isNotified = entry.status === 'NOTIFIED';
              const isSeated = entry.status === 'SEATED';
              const isNext = isWaiting && index === 0;
              const isLargeGroup = !isTakeaway && (entry.party_size || 0) >= 6;
              const loading = isProcessing === entry.id;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const anyEntry = entry as any;
              const isVIP = anyEntry.is_vip || false;
              const hasPreOrder = anyEntry.pre_order_amount && anyEntry.pre_order_amount > 0;

              // Filter tables matching party size directly from current tables state
              const seatableForParty = isTakeaway ? [] : availableTables.filter((t) => (t.capacity || 0) >= entry.party_size);

              // Theme styling per status
              const cardTheme = isCalled
                  ? {
                      container: 'bg-gradient-to-r from-blue-950/40 via-[#0F172A] to-[#0A0F1D] border-blue-500/35 shadow-[0_0_25px_rgba(59,130,246,0.12)]',
                      accentLine: 'bg-gradient-to-b from-blue-400 via-blue-500 to-indigo-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]',
                      ticketBox: 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/30 border border-blue-400/40',
                      badge: 'bg-blue-500/20 border-blue-400/40 text-blue-300 font-bold',
                    }
                  : isNotified
                  ? {
                      container: 'bg-gradient-to-r from-purple-950/40 via-[#0F172A] to-[#0A0F1D] border-purple-500/35 shadow-[0_0_25px_rgba(168,85,247,0.12)]',
                      accentLine: 'bg-gradient-to-b from-purple-400 via-purple-500 to-pink-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]',
                      ticketBox: 'bg-gradient-to-br from-purple-600 to-pink-700 text-white shadow-lg shadow-purple-500/30 border border-purple-400/40',
                      badge: 'bg-purple-500/20 border-purple-400/40 text-purple-300 font-bold',
                    }
                  : isSeated
                  ? {
                      container: 'bg-gradient-to-r from-emerald-950/40 via-[#0F172A] to-[#0A0F1D] border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.12)]',
                      accentLine: 'bg-gradient-to-b from-emerald-400 to-teal-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]',
                      ticketBox: 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-500/30 border border-emerald-400/40',
                      badge: 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300 font-bold',
                    }
                  : isNext
                  ? {
                      container: 'bg-gradient-to-r from-cyan-950/40 via-[#0F172A] to-[#0A0F1D] border-cyan-500/35 shadow-[0_0_20px_rgba(6,182,212,0.12)]',
                      accentLine: 'bg-gradient-to-b from-cyan-400 to-blue-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]',
                      ticketBox: 'bg-gradient-to-br from-cyan-900/60 to-blue-900/80 text-cyan-300 shadow-md border border-cyan-500/40',
                      badge: 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300 font-bold',
                    }
                  : {
                      container: 'bg-[#111827] hover:bg-[#141E30] border-white/10 hover:border-white/20 shadow-md',
                      accentLine: 'bg-slate-700',
                      ticketBox: 'bg-[#1E293B] border border-white/10 text-slate-200 shadow-sm',
                      badge: 'bg-white/5 border-white/10 text-slate-300',
                    };

                // Formatted display number
                const rawNum = (entry.display_number || entry.queue_number || '').toString();
                const cleanNum = isTakeaway
                  ? (rawNum.startsWith('T-') ? rawNum : `T-${rawNum.replace(/^[#QT-]+/, '')}`)
                  : (rawNum.startsWith('Q-') ? rawNum : `Q-${rawNum.replace(/^#+/, '')}`);

                // Elapsed wait time
                const joinedTimestamp = new Date(entry.joined_at || entry.created_at).getTime();
                const waitMins = Math.max(0, Math.floor((Date.now() - joinedTimestamp) / 60000));

                return (
                  <div
                    key={entry.id}
                    className={`relative p-4 sm:p-5 rounded-2xl border flex flex-col gap-3.5 overflow-hidden transition-all duration-200 group ${cardTheme.container} ${
                      loading ? 'opacity-50 pointer-events-none' : ''
                    }`}
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
                              ? (isCalled ? 'PICKUP' : isNext ? 'UP NEXT' : `#${index + 1} IN LINE`)
                              : (isSeated
                                ? 'DINING'
                                : isCalled
                                ? 'PRIORITY'
                                : isNotified
                                ? 'ARRIVING'
                                : isNext
                                ? 'UP NEXT'
                                : `#${index + 1} IN LINE`)}
                          </span>
                        </div>

                        {/* Guest Profile & Metadata */}
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base sm:text-lg font-black text-white tracking-tight truncate">
                              {entry.customer_name}
                            </span>
                            {isTakeaway && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-black border border-amber-500/30 shrink-0">
                                🛍️ TAKEAWAY
                              </span>
                            )}
                            {isVIP && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-black border border-amber-500/30 shrink-0">
                                <span>⭐</span> VIP
                              </span>
                            )}
                            {isLargeGroup && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 text-[10px] font-black border border-orange-500/30 shrink-0">
                                <span>🔥</span> Large Group
                              </span>
                            )}
                          </div>

                          {/* Contact & Party details */}
                          <div className="flex items-center gap-2 mt-0.5 text-xs sm:text-[13px] text-slate-300 flex-wrap">
                            {isTakeaway ? (
                              <span className="font-semibold text-amber-300 flex items-center gap-1">
                                🛍️ Counter Pickup
                              </span>
                            ) : (
                              <span className="font-semibold text-slate-200">
                                👥 {entry.party_size} {entry.party_size === 1 ? 'guest' : 'guests'}
                              </span>
                            )}
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

                          {/* Customer Late Alert Banner */}
                          {entry.lateInfo?.isLate && (
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
                        {isNotified && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                            NOTIFIED
                          </span>
                        )}
                        {isCalled && isTakeaway && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] tracking-widest uppercase font-black shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            {anyEntry.call_response === 'ACCEPTED' ? 'AT COUNTER' : 'CALLING FOR PICKUP'}
                          </span>
                        )}
                        {isCalled && !isTakeaway && (
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
                      </div>
                    </div>

                    {/* ACTION RIBBON: High-Visibility, Tactile Staff Action Bar */}
                    <div className="flex flex-col gap-2.5 pt-3 border-t border-white/10 -mx-4 -mb-4 px-4 py-3 rounded-b-2xl bg-[#080D1A]/60">
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
                        {/* TAKEAWAY ACTIONS */}
                        {isTakeaway && isWaiting && (
                          <button
                            type="button"
                            onClick={() => handleCall(entry.id)}
                            disabled={loading}
                            className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-95 text-white text-sm font-black shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>📢</span>
                            <span>Call for Pickup</span>
                          </button>
                        )}

                        {isTakeaway && isCalled && (
                          <button
                            type="button"
                            onClick={async () => {
                              setIsProcessing(entry.id);
                              chimeEngine.playAlertChime();
                              try {
                                const res = await completeTakeawayAction(entry.id);
                                if (!res.success) {
                                  alert(res.error || 'Could not complete takeaway entry.');
                                  return;
                                }
                                setFeed((prev) => prev.filter((e) => e.id !== entry.id));
                                await broadcastCustomerQueueUpdate(entry.id);
                                router.refresh();
                              } catch (e) {
                                console.error('Failed to complete takeaway:', e);
                                alert('Could not complete takeaway entry.');
                              } finally {
                                setIsProcessing(null);
                              }
                            }}
                            disabled={loading}
                            className="col-span-2 sm:col-span-1 px-5 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-emerald-950/40 transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
                          >
                            <span className="material-symbols-outlined text-[16px]">check_circle</span>
                            <span>Items Received</span>
                          </button>
                        )}

                        {isTakeaway && (
                          <Link
                            href="/dashboard/queue"
                            className="h-11 px-3.5 rounded-xl bg-white/[0.04] hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center gap-1.5 text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                            title="Manage takeaway order"
                          >
                            <span className="material-symbols-outlined text-[17px]">receipt_long</span>
                            <span className="hidden sm:inline">Order</span>
                          </Link>
                        )}

                        {/* DINE-IN Step 1: WAITING -> Notify */}
                        {!isTakeaway && isWaiting && (
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

                        {/* DINE-IN Step 2: NOTIFIED -> Call */}
                        {!isTakeaway && isNotified && (
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

                        {/* DINE-IN Step 3: CALLED -> Assign Table & Seat (Gated strictly on customer acceptance) */}
                        {!isTakeaway && isCalled && (
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
                                  // Optimistic remove seated guest and mark table(s) occupied
                                  setFeed((prev) => prev.filter((e) => e.id !== entry.id));
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
                                      setFeed((prev) => prev.filter((e) => e.id !== entry.id));
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
                                  className="px-2 h-11 text-slate-400 hover:text-white text-xs"
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
                                className="w-full sm:w-auto px-4 h-11 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                              >
                                Remove / No-Show
                              </button>
                            )}
                          </div>
                        )}

                      {/* Pass to Next Button for Late Guests */}
                      {entry.lateInfo?.isLate && !entry.lateInfo.tablePassedToNext && (
                        <button
                          type="button"
                          onClick={() => handlePassToNext(entry.id)}
                          disabled={loading}
                          className="h-11 px-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all active:scale-95 shadow cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                          title="Seat next guest and hold this customer's spot"
                        >
                          <span className="material-symbols-outlined text-[16px]">fast_forward</span>
                          <span>Pass to Next</span>
                        </button>
                      )}

                      {/* Chat Button */}
                      <button
                        type="button"
                        onClick={() => setChatEntry(entry)}
                        className="h-11 px-3.5 rounded-xl bg-white/[0.04] hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/5 hover:border-cyan-500/30 flex items-center justify-center gap-1.5 text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
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

                      {/* Cancel Button */}
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
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* RIGHT COLUMN: Real-time Floor Matrix & Table Controls */}
      <section className="lg:col-span-4 flex flex-col gap-6">
        <div className="bg-[#111827] rounded-2xl border border-white/5 p-6 flex flex-col gap-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <div className="flex flex-col">
              <span className="text-lg font-bold text-white">Floor Status</span>
              <span className="text-xs text-slate-400">{tablesTotal} Total Tables Configured</span>
            </div>
            <div className="px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold">
              {tablesOccupied} Occupied
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {tables.slice(0, 4).map((t) => {
              const isCleaning = t.status === 'CLEANING';
              const isOccupied = t.status === 'OCCUPIED';
              const isAvailable = t.status === 'AVAILABLE';
              const loading = isProcessing === `table-${t.id}`;
              const rawNum = (t.tableNumber || t.table_number || '').toString();
              const tNum = rawNum.startsWith('T') ? rawNum : `T${rawNum}`;

              let borderCls = 'border-white/10 bg-[#0A0E17]/80';
              let shadowCls = '';
              let dotCls = 'bg-slate-500';
              let pillCls = 'bg-[#1A2333] border-white/10 text-slate-400';
              let notchCls = 'bg-[#151D2A] text-slate-200 border border-white/10';

              if (isCleaning) {
                borderCls = 'border-rose-500/40 bg-gradient-to-br from-rose-950/40 via-[#180E1A]/90 to-[#0A0E17]';
                shadowCls = 'shadow-[0_0_20px_rgba(244,63,94,0.18)]';
                dotCls = 'bg-rose-400 animate-ping';
                pillCls = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
                notchCls = 'bg-gradient-to-br from-rose-600 to-pink-700 text-white shadow-md shadow-rose-950/50';
              } else if (isOccupied) {
                borderCls = 'border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-[#171320]/90 to-[#0A0E17]';
                shadowCls = 'shadow-[0_0_20px_rgba(245,158,11,0.18)]';
                dotCls = 'bg-amber-400 animate-pulse';
                pillCls = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
                notchCls = 'bg-gradient-to-br from-amber-600 to-yellow-700 text-white shadow-md shadow-amber-950/50';
              } else if (isAvailable) {
                borderCls = 'border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-[#0B1720]/90 to-[#0A0E17]';
                shadowCls = 'shadow-[0_0_20px_rgba(16,185,129,0.18)]';
                dotCls = 'bg-emerald-400 animate-pulse';
                pillCls = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
                notchCls = 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-950/50';
              }

              return (
                <div
                  key={t.id}
                  className={`rounded-2xl border p-3.5 flex flex-col justify-between text-left transition-all duration-200 backdrop-blur-md relative overflow-hidden ${borderCls} ${shadowCls} ${
                    loading ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <div>
                    {/* Header: Table notch & Status pill */}
                    <div className="w-full flex justify-between items-center mb-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-black text-xs ${notchCls}`}>
                        {tNum}
                      </div>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border flex items-center gap-1 shrink-0 ${pillCls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                        {isAvailable ? 'READY' : isCleaning ? 'CLEAN' : t.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-300 mb-3">
                      <span className="font-semibold text-white">👥 {t.capacity} Seats</span>
                      <span className="text-[10px] text-slate-400">
                        {isAvailable ? '✨ Open' : isCleaning ? '🧹 Dirty' : 'Dining'}
                      </span>
                    </div>
                  </div>

                  {/* Contextual Action Buttons */}
                  {isCleaning && (
                    <div className="flex gap-1.5 w-full mt-1">
                      <button
                        type="button"
                        onClick={() => handlePingBusser(t.id)}
                        disabled={loading}
                        className="flex-1 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-rose-500/30 cursor-pointer active:scale-95"
                      >
                        Ping
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTableStatus(t.id, 'AVAILABLE', 'CLEANING')}
                        disabled={loading}
                        className="flex-1 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-emerald-500/40 cursor-pointer active:scale-95"
                      >
                        Ready
                      </button>
                    </div>
                  )}

                  {isOccupied && (
                    <div className="flex gap-1.5 w-full mt-1">
                      <Link
                        href="/dashboard/orders"
                        className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-amber-300 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-amber-500/30"
                      >
                        Orders
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleTableStatus(t.id, 'CLEANING', 'OCCUPIED')}
                        disabled={loading}
                        className="flex-1 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-rose-500/30 cursor-pointer active:scale-95"
                      >
                        Clean
                      </button>
                    </div>
                  )}

                  {isAvailable && (
                    <div className="flex gap-1.5 w-full mt-1">
                      <Link
                        href="/dashboard/tables"
                        className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-emerald-400 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-emerald-500/30"
                      >
                        Map
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleTableStatus(t.id, 'OCCUPIED', 'AVAILABLE')}
                        disabled={loading}
                        className="flex-1 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-emerald-500/40 cursor-pointer active:scale-95"
                      >
                        Seat
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Link
            href="/dashboard/tables"
            className="w-full mt-2 py-3 rounded-xl bg-[#1A2333] hover:bg-white/5 border border-white/5 text-slate-300 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
          >
            Manage Tables Map <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </Link>
        </div>
      </section>

      {/* Staff Guest Communications Modal */}
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



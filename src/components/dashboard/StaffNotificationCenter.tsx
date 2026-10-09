'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { getActivityFeedAction } from '@/app/dashboard/actions';
import { chimeEngine } from '@/lib/audio-chime';
import type { DashboardActivityItem } from '@/lib/services/activity-service';

interface StaffNotificationCenterProps {
  restaurantId: string;
  initialFeed?: DashboardActivityItem[];
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function StaffNotificationCenter({
  restaurantId,
  initialFeed = [],
}: StaffNotificationCenterProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [feed, setFeed] = useState<DashboardActivityItem[]>(initialFeed);
  const [filterType, setFilterType] = useState<'ALL' | 'QUEUE' | 'ORDER' | 'ALERT'>('ALL');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastSeenTime, setLastSeenTime] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`queueflow_staff_last_seen_${restaurantId}`);
      return stored ? parseInt(stored, 10) : Date.now() - 3600000;
    }
    return Date.now() - 3600000;
  });

  const [isPending, startTransition] = useTransition();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch feed on open and periodically
  const fetchFeed = () => {
    startTransition(async () => {
      const res = await getActivityFeedAction(restaurantId);
      if (res.success && res.items) {
        setFeed(res.items);
      }
    });
  };

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchFeed();
      }
    }, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  // Count unread items (created after lastSeenTime)
  const unreadCount = feed.filter(
    (item) => new Date(item.time).getTime() > lastSeenTime
  ).length;

  const handleOpen = () => {
    chimeEngine.playButtonClick();
    setIsOpen(true);
    fetchFeed();
  };

  const handleClose = () => {
    setIsOpen(false);
    const now = Date.now();
    setLastSeenTime(now);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`queueflow_staff_last_seen_${restaurantId}`, now.toString());
    }
  };

  const handleMarkAllRead = () => {
    chimeEngine.playButtonClick();
    const now = Date.now();
    setLastSeenTime(now);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`queueflow_staff_last_seen_${restaurantId}`, now.toString());
    }
  };

  const handleTestSound = () => {
    chimeEngine.playSeatChime();
  };

  // Close when clicking outside modal
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen && modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const queueCount = feed.filter((i) => i.type === 'QUEUE').length;
  const orderCount = feed.filter((i) => i.type === 'ORDER').length;
  const alertCount = feed.filter((i) => i.type === 'ALERT' || i.type === 'SYSTEM').length;

  const filteredFeed = feed.filter((item) => {
    if (filterType === 'ALL') return true;
    if (filterType === 'QUEUE') return item.type === 'QUEUE';
    if (filterType === 'ORDER') return item.type === 'ORDER';
    if (filterType === 'ALERT') return item.type === 'ALERT' || item.type === 'SYSTEM';
    return true;
  });

  return (
    <>
      {/* Top Navbar Trigger Button */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Notifications (${unreadCount} unread)`}
        title="Live Operations & Activity Feed"
        className={`w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center transition-all relative ${
          unreadCount > 0
            ? 'bg-blue-600/20 border-blue-500/40 text-blue-300 hover:bg-blue-600/30'
            : 'bg-white/[0.06] border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/10'
        }`}
      >
        <span className="material-symbols-outlined text-[19px]">notifications</span>

        {unreadCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 border-2 border-[#0A0E17] text-white text-[10px] font-black font-mono flex items-center justify-center shadow-lg animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500/80 border-2 border-[#0A0E17]"></span>
        )}
      </button>

      {/* Portal Container mounted directly into document.body to avoid backdrop-filter/header clipping */}
      {mounted &&
        isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[99999] flex items-end sm:items-start justify-center sm:justify-end p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
              ref={modalRef}
              className="w-full sm:w-[440px] max-w-full h-[85vh] sm:h-[620px] max-h-[92vh] bg-[#0a0f19] border border-white/15 rounded-t-3xl sm:rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] flex flex-col justify-between overflow-hidden animate-in slide-in-from-bottom sm:slide-in-from-right-4 duration-300"
            >
              {/* Drawer Header */}
              <div className="p-4 sm:p-5 border-b border-white/10 bg-[#0d1424] space-y-3 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                      <span className="material-symbols-outlined text-xl">bolt</span>
                    </div>
                    <div>
                      <h2 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                        Live Activity Feed
                        {unreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-mono font-bold">
                            {unreadCount} new
                          </span>
                        )}
                      </h2>
                      <p className="text-[11px] text-slate-400 font-medium">
                        Real-time queue, kitchen & table telemetry
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                {/* Status Ribbon & Controls */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>Realtime Stream Active</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[11px] font-bold text-slate-400 hover:text-blue-400 transition-colors"
                    >
                      Mark read
                    </button>
                    <span className="text-slate-600">•</span>
                    <button
                      type="button"
                      onClick={fetchFeed}
                      disabled={isPending}
                      className="text-[11px] font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                    >
                      <span
                        className={`material-symbols-outlined text-[13px] ${
                          isPending ? 'animate-spin' : ''
                        }`}
                      >
                        refresh
                      </span>
                      Refresh
                    </button>
                  </div>
                </div>

                {/* Category Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 scrollbar-none">
                  <button
                    type="button"
                    onClick={() => setFilterType('ALL')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      filterType === 'ALL'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    All ({feed.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('QUEUE')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      filterType === 'QUEUE'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Queue ({queueCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('ORDER')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      filterType === 'ORDER'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Orders ({orderCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('ALERT')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      filterType === 'ALERT'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Alerts ({alertCount})
                  </button>
                </div>
              </div>

              {/* Event List Feed */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
                {filteredFeed.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                    <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
                      <span className="material-symbols-outlined text-2xl">notifications_none</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">No Recent Activity</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        New actions, table seatings, and kitchen updates will appear here live.
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredFeed.map((item) => {
                    const isUnread = new Date(item.time).getTime() > lastSeenTime;

                    const iconBg =
                      item.severity === 'success'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : item.severity === 'warning'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : item.severity === 'error'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/30';

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl border transition-all ${
                          isUnread
                            ? 'bg-blue-950/20 border-blue-500/30 shadow-sm'
                            : 'bg-[#0f1626] border-white/5 hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${iconBg}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                {item.title}
                                {isUnread && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                                )}
                              </h4>
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                {formatRelativeTime(item.time)}
                              </span>
                            </div>

                            <p className="text-xs text-slate-300 mt-1 leading-relaxed break-words">
                              {item.message}
                            </p>

                            <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-white/5">
                              {item.badge ? (
                                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-mono text-[10px] font-bold">
                                  {item.badge}
                                </span>
                              ) : (
                                <span />
                              )}

                              {item.href && (
                                <Link
                                  href={item.href}
                                  onClick={handleClose}
                                  className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors"
                                >
                                  <span>View Details</span>
                                  <span className="material-symbols-outlined text-[13px]">
                                    arrow_forward
                                  </span>
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Drawer Footer: Sound controls & audio testing */}
              <div className="p-3.5 sm:p-4 border-t border-white/10 bg-[#0d1424] flex items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px] text-slate-400">
                    {soundEnabled ? 'volume_up' : 'volume_off'}
                  </span>
                  <span>{soundEnabled ? 'Chimes Active' : 'Sound Muted'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestSound}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-200 transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[15px] text-amber-400">
                    play_arrow
                  </span>
                  <span>Test Bell</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useNotificationRealtime } from '@/lib/realtime/hooks';

interface StaffNotificationItem {
  id: string;
  notification_type: string;
  message: string;
  created_at: string;
}

export function StaffNotificationBell({ restaurantId }: { restaurantId: string }) {
  const [notifications, setNotifications] = useState<StaffNotificationItem[]>([]);
  const [open, setOpen] = useState<boolean>(false);

  const loadNotifications = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const res = await fetch(`/api/staff/notifications?restaurantId=${restaurantId}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch {
      // Silent fallback
    }
  }, [restaurantId]);

  // Realtime primary, polling fallback
  useNotificationRealtime(restaurantId, !!restaurantId);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // Fallback every 60s
    const onVisible = () => { if (document.visibilityState === 'visible') loadNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadNotifications]);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="text-lg">🔔</span>
        {notifications.length > 0 && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900 animate-pulse" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Recent Alerts
            </h4>
            <span className="text-[10px] font-semibold text-slate-400">
              {notifications.length} Unread
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2">
            {notifications.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-3">No recent notifications.</div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-xs space-y-0.5"
                >
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {item.notification_type}
                  </div>
                  <div className="text-slate-600 dark:text-slate-400 text-[11px] leading-tight">
                    {item.message}
                  </div>
                  <div className="text-[10px] text-slate-400 pt-0.5">
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

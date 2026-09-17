'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface NotificationItem {
  id: string;
  notification_type: string;
  message: string;
  metadata?: {
    title?: string;
  };
  created_at: string;
}

export function CustomerNotificationBanner({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/customer/notifications?token=${token}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch {
      // Silent fallback
    }
  }, [token]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // Fallback 60s (realtime is primary if later added)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchNotifications]);

  if (notifications.length === 0 || !notifications[0]) return null;

  const latest = notifications[0];

  return (
    <div className="w-full bg-gradient-to-r from-emerald-600 to-indigo-600 text-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-emerald-400/30 animate-fade-in">
      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shrink-0">
        🔔
      </div>
      <div className="space-y-0.5 flex-1 min-w-0">
        <div className="font-extrabold text-xs uppercase tracking-wider text-emerald-200">
          {latest.metadata?.title || latest.notification_type}
        </div>
        <p className="text-xs font-semibold leading-snug break-words">
          {latest.message}
        </p>
      </div>
    </div>
  );
}

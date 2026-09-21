'use client';

import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  getNotificationPermissionState,
  requestUserQueueAlerts,
  isNotificationSupported,
} from '@/lib/notifications/web-notification';
import { chimeEngine } from '@/lib/audio-chime';
import { startBackgroundKeeper } from '@/lib/audio-background-keeper';

interface CustomerLockscreenNotificationBannerProps {
  restaurantName?: string;
}

export function CustomerLockscreenNotificationBanner({
  restaurantName = 'restaurant',
}: CustomerLockscreenNotificationBannerProps) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    if (!isNotificationSupported()) {
      setPermission('unsupported');
      return;
    }

    const current = getNotificationPermissionState();
    setPermission(current);
    if (current === 'granted') {
      startBackgroundKeeper();
    }

    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          status.onchange = () => {
            const next = getNotificationPermissionState();
            setPermission(next);
            if (next === 'granted') {
              startBackgroundKeeper();
            }
          };
        })
        .catch(() => {});
    }
  }, []);

  if (permission === 'unsupported') {
    return null;
  }

  const handleAllowClick = async () => {
    setIsRequesting(true);
    try {
      chimeEngine.initAudio();
      startBackgroundKeeper();
      const granted = await requestUserQueueAlerts();
      if (granted) {
        setPermission('granted');
        startBackgroundKeeper();
      } else {
        setPermission(getNotificationPermissionState());
      }
    } catch {
      setPermission(getNotificationPermissionState());
    } finally {
      setIsRequesting(false);
    }
  };

  // 1. Permission GRANTED: Reassuring, elegant active state
  if (permission === 'granted') {
    return (
      <aside
        aria-label="Notification alerts active"
        className="customer-glass-surface flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border border-[var(--qf-success)]/30 bg-[var(--qf-success)]/10 text-left shadow-sm"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[var(--qf-success)]/20 text-[var(--qf-success)]">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Lock-Screen Alerts Active</span>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--qf-success)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--qf-success)]" />
              </span>
            </p>
            <p className="text-[11px] text-slate-300/90 truncate">
              Phone will buzz &amp; notify you even if you switch apps
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[var(--qf-success)]">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Ready</span>
        </div>
      </aside>
    );
  }

  // 2. Permission DENIED: Informative instructions to unblock
  if (permission === 'denied') {
    return (
      <aside
        aria-label="Notification alerts blocked"
        className="customer-glass-surface flex items-start gap-2.5 px-3.5 py-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-left"
      >
        <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
        <div className="text-[11px] text-slate-300 leading-relaxed">
          <span className="font-bold text-rose-300 block">Alerts blocked in browser settings</span>
          Tap the lock/tune icon next to the website URL to allow notifications for table calls.
        </div>
      </aside>
    );
  }

  // 3. Permission DEFAULT: High-prominence, 1-tap enable prompt
  return (
    <aside
      aria-label="Enable lock-screen alerts"
      className="customer-glass-surface p-3.5 sm:p-4 rounded-2xl border border-[var(--qf-primary)]/40 bg-gradient-to-r from-[var(--qf-primary)]/15 via-[var(--qf-surface)]/80 to-[var(--qf-primary)]/10 text-left shadow-lg space-y-3"
    >
      <div className="flex items-start gap-3">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--qf-primary)]/25 text-[var(--qf-primary)] border border-[var(--qf-primary)]/30">
          <Bell className="h-4.5 w-4.5 animate-pulse" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-xs sm:text-sm font-black tracking-tight text-white flex items-center gap-1.5">
            <span>Allow Lock-Screen Alerts</span>
            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-[var(--qf-primary)] text-slate-950">
              Recommended
            </span>
          </h3>
          <p className="text-[11px] sm:text-xs text-slate-300 leading-snug">
            Receive loud buzzer and lock-screen alerts when {restaurantName} calls your table, even if you switch apps or lock your phone.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleAllowClick}
        disabled={isRequesting}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm transition-all duration-200 cursor-pointer shadow-md bg-[var(--qf-primary)] text-slate-950 hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      >
        <Bell className="h-4 w-4 shrink-0" />
        <span>{isRequesting ? 'Requesting permission…' : 'Allow Lock-Screen Alerts'}</span>
      </button>
    </aside>
  );
}

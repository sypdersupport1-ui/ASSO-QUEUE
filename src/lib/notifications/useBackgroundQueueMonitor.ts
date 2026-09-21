'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { chimeEngine } from '@/lib/audio-chime';
import { startBackgroundKeeper } from '@/lib/audio-background-keeper';
import {
  registerServiceWorker,
  triggerBackgroundTicketNotification,
  registerBackgroundPoll,
  stopBackgroundPoll,
} from './web-notification';

interface UseBackgroundQueueMonitorProps {
  token: string;
  restaurantSlug: string;
  initialStatus: string;
  partySize?: number;
  ticketNo?: string;
  isTerminal?: boolean;
  onStatusUpdate?: (fresh: import('@/lib/services/queue-service').PublicQueueStatusResponse) => void;
}

/**
 * Background queue status monitor that keeps polling even when the browser tab is hidden/minimized.
 * When the restaurant host calls the ticket, it triggers:
 * 1. OS-level lock-screen notification (via ServiceWorker showNotification)
 * 2. High-attention chime/buzzer audio alert
 * 3. Haptic device vibration pattern
 * 4. Authoritative UI refresh
 */
export function useBackgroundQueueMonitor({
  token,
  restaurantSlug,
  initialStatus,
  partySize = 1,
  ticketNo,
  isTerminal = false,
  onStatusUpdate,
}: UseBackgroundQueueMonitorProps) {
  const router = useRouter();
  const lastStatusRef = useRef(initialStatus);

  useEffect(() => {
    lastStatusRef.current = initialStatus;
  }, [initialStatus]);

  useEffect(() => {
    if (isTerminal || !token) return;

    // Ensure Service Worker is registered and mobile background keeper is running
    registerServiceWorker().catch(() => {});
    startBackgroundKeeper();

    // Register SW-level background polling — works even when page JS is throttled/suspended
    registerBackgroundPoll(token, restaurantSlug, initialStatus).catch(() => {});

    const checkStatus = async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;

        const res = await fetch(
          `/api/q/status?token=${encodeURIComponent(token)}&restaurantSlug=${encodeURIComponent(restaurantSlug)}`,
          {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache, no-store',
            },
          }
        );

        if (!res.ok) return;
        const data = await res.json();
        const fresh = data?.status;
        const serverStatus = fresh?.status;
        if (!serverStatus) return;

        if (onStatusUpdate) {
          onStatusUpdate(fresh);
        }

        const prev = lastStatusRef.current;
        if (prev && prev !== serverStatus) {
          lastStatusRef.current = serverStatus;

          const currentUrl = typeof window !== 'undefined' ? window.location.href : undefined;

          if (serverStatus === 'CALLED') {
            triggerBackgroundTicketNotification(
              '⚡ YOUR TABLE IS READY!',
              ticketNo
                ? `Ticket #${ticketNo} is called! Please proceed to the restaurant host now.`
                : `Party of ${fresh?.partySize || partySize} — please return to the restaurant now!`,
              currentUrl
            );
            chimeEngine.playBuzzerSound();
            try {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate([400, 150, 400, 150, 600]);
              }
            } catch {}
          } else if (serverStatus === 'NOTIFIED') {
            triggerBackgroundTicketNotification(
              "⚡ You're Getting Close! Table Preparing",
              'The restaurant host is preparing your table. Please start heading to the entrance now!',
              currentUrl
            );
            chimeEngine.playBuzzerSound();
          } else if (serverStatus === 'SEATED') {
            triggerBackgroundTicketNotification(
              '🍽️ You Are Seated!',
              'Welcome to your table! Enjoy your meal.',
              currentUrl
            );
            chimeEngine.playSeatChime();
          } else if (serverStatus === 'NO_SHOW') {
            triggerBackgroundTicketNotification(
              'Queue Status Update',
              'You have been marked as no-show by the restaurant.',
              currentUrl
            );
            chimeEngine.playAlertChime();
          } else if (serverStatus === 'CANCELLED') {
            triggerBackgroundTicketNotification(
              'Queue Ticket Cancelled',
              'Your queue ticket has been cancelled.',
              currentUrl
            );
            chimeEngine.playAlertChime();
          }

          try {
            router.refresh();
          } catch {}

          // Stop SW background polling when ticket reaches terminal state
          if (['SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(serverStatus)) {
            stopBackgroundPoll().catch(() => {});
          }
        }
      } catch {
        // Silently continue on next tick
      }
    };

    // Active polling interval (2s):
    // Crucial: NOT restricted to document.visibilityState === 'visible'
    // so background tabs and locked phones receive the status transition in real-time.
    const interval = setInterval(checkStatus, 2000);

    const onWake = () => {
      checkStatus();
      try { router.refresh(); } catch {}
    };

    window.addEventListener('focus', onWake);
    window.addEventListener('queue_update', onWake);
    window.addEventListener('queue_poll_tick', onWake);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onWake();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('queue_update', onWake);
      window.removeEventListener('queue_poll_tick', onWake);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token, restaurantSlug, partySize, ticketNo, isTerminal, router, onStatusUpdate]);
}

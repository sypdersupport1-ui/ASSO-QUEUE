'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { chimeEngine } from '@/lib/audio-chime';
import { startBackgroundKeeper } from '@/lib/audio-background-keeper';
import {
  registerServiceWorker,
  triggerBackgroundTicketNotification,
} from './web-notification';

interface UseBackgroundQueueMonitorProps {
  token: string;
  restaurantSlug: string;
  initialStatus: string;
  partySize?: number;
  ticketNo?: string;
  isTerminal?: boolean;
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

    // Active polling interval (2.5s):
    // Crucial: NOT restricted to document.visibilityState === 'visible'
    // so background tabs and locked phones receive the status transition in real-time.
    const interval = setInterval(async () => {
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
        const serverStatus = data?.status?.status;
        if (!serverStatus) return;

        const prev = lastStatusRef.current;
        if (prev && prev !== serverStatus) {
          lastStatusRef.current = serverStatus;

          const currentUrl = typeof window !== 'undefined' ? window.location.href : undefined;

          if (serverStatus === 'CALLED') {
            triggerBackgroundTicketNotification(
              '⚡ YOUR TABLE IS READY!',
              ticketNo
                ? `Ticket #${ticketNo} is called! Please proceed to the restaurant host now.`
                : `Party of ${data.status?.partySize || partySize} — please return to the restaurant now!`,
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
          }

          try {
            router.refresh();
          } catch {}
        }
      } catch {
        // Silently continue on next tick
      }
    }, 2500);

    return () => {
      clearInterval(interval);
    };
  }, [token, restaurantSlug, partySize, ticketNo, isTerminal, router]);
}

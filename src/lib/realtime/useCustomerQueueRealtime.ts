'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/db/supabase/client';
import type { RealtimeConnectionState } from './types';

/**
 * Customer queue realtime - NARROWLY SCOPED via broadcast.
 * Security: Customer is anon (no auth). Do NOT subscribe to entire restaurant queue.
 * We use a broadcast channel named `queue-entry:${entryId}` - bearer via entryId (UUID, not guessable).
 * Server/staff broadcasts to this channel after queue status changes; customer refetches authoritative status.
 * Fallback polling remains as safety net.
 *
 * Phase 4E attention/recovery contract (presentation only, never authority):
 * - broadcast ping        → authoritative router.refresh()
 * - tab becomes visible   → authoritative router.refresh() (throttled, timestamp
 *                           guard only — NOT another polling timer)
 * - browser goes online   → authoritative router.refresh() immediately instead
 *                           of waiting for the next 10s fallback tick
 * - offline               → last-known ticket stays rendered; the status line
 *                           shows Reconnecting… (see CustomerQueueRealtime)
 * Missed events need no catch-up queue: every trigger re-reads server truth,
 * so a customer returning 5 minutes after CALLED still sees CALLED.
 */
export function useCustomerQueueRealtime(entryId: string, enabled = true) {
  const router = useRouter();
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('CONNECTING');
  const channelRef = useRef<ReturnType<ReturnType<typeof createBrowserClient>['channel']> | null>(null);

  const revalidate = useCallback(() => {
    try { router.refresh(); } catch {}
  }, [router]);

  useEffect(() => {
    if (!enabled || !entryId) {
      setConnectionState('DISCONNECTED');
      return;
    }

    let isMounted = true;
    const supabase = createBrowserClient();
    const channelName = `customer-queue:${entryId}`;
    const channel = supabase.channel(channelName);

    channel.on('broadcast', { event: 'queue_update' }, () => {
      if (!isMounted) return;
      revalidate();
    });

    channel.subscribe((status: string) => {
      if (!isMounted) return;
      if (status === 'SUBSCRIBED') {
        setConnectionState('CONNECTED');
        revalidate();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnectionState('ERROR');
      } else if (status === 'CLOSED') {
        setConnectionState('DISCONNECTED');
      } else {
        setConnectionState('CONNECTING');
      }
    });

    channelRef.current = channel as unknown as typeof channelRef.current;

    // Fallback: 10s when active (customer needs near-realtime), 30s otherwise
    const fallback = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) revalidate();
    }, 10000);

    // Phase 4E: return-to-tab / reconnect recovery. One shared timestamp
    // guard (not a timer) so rapid hidden→visible toggles or online flaps
    // cannot flood the server with refreshes; each accepted trigger still
    // performs a full authoritative revalidation.
    const lastRecoveryRef = { at: 0 };
    const recover = (reason: 'visible' | 'online') => {
      const now = Date.now();
      if (now - lastRecoveryRef.at < 2000) return;
      lastRecoveryRef.at = now;
      if (reason === 'visible' && document.visibilityState !== 'visible') return;
      revalidate();
    };
    const onVisibility = () => { recover('visible'); };
    const onOnline = () => { recover('online'); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      isMounted = false;
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current as unknown as never);
        channelRef.current = null;
      }
      setConnectionState('DISCONNECTED');
    };
  }, [entryId, enabled, revalidate]);

  return { connectionState, revalidate };
}

/**
 * Helper for staff to broadcast to customer's narrow channel after queue update.
 * Call this from staff browser after successful updateQueueStatus.
 */
export async function broadcastCustomerQueueUpdate(entryId: string) {
  try {
    const supabase = createBrowserClient();
    const channel = supabase.channel(`customer-queue:${entryId}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 5000);
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          reject(new Error(status));
        }
      });
    });
    await channel.send({ type: 'broadcast', event: 'queue_update', payload: { entryId } } as never);
    // Keep channel briefly to ensure delivery, then cleanup
    setTimeout(() => {
      supabase.removeChannel(channel as unknown as never);
    }, 1000);
  } catch {}
}

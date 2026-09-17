'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/db/supabase/client';
import type { RealtimeConnectionState } from './types';

interface UseRealtimeChannelOptions {
  channelName: string;
  table: string;
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  restaurantId?: string;
  enabled?: boolean;
  fallbackIntervalMs?: number;
  onRealtimeEvent?: (payload: unknown) => void;
}

/**
 * Reusable realtime subscription hook.
 * Architecture: Postgres is truth, Realtime is delivery, Browser is presentation.
 * On Realtime event: re-fetch authoritative data via router.refresh() (never apply payload blindly).
 * Handles: single subscription, cleanup, visibility, fallback polling, reconnection re-fetch.
 */
export function useRealtimeChannel(options: UseRealtimeChannelOptions) {
  const {
    channelName,
    table,
    filter,
    event = '*',
    restaurantId,
    enabled = true,
    fallbackIntervalMs = 60000,
    onRealtimeEvent,
  } = options;

  const router = useRouter();
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('CONNECTING');
  const channelRef = useRef<ReturnType<ReturnType<typeof createBrowserClient>['channel']> | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const revalidate = useCallback(() => {
    try {
      router.refresh();
    } catch {}
  }, [router]);

  useEffect(() => {
    if (!enabled) {
      setConnectionState('DISCONNECTED');
      return;
    }

    let isMounted = true;
    const supabase = createBrowserClient();

    const channel = supabase.channel(channelName);

    // Postgres changes subscription - single per domain
    channel.on(
      'postgres_changes' as never,
      {
        event,
        schema: 'public',
        table,
        filter,
      } as never,
      (payload: unknown) => {
        if (!isMounted) return;
        // Structured log redacted - no sensitive data
        if (process.env.NODE_ENV !== 'production') console.debug('[realtime] event', { channelName, table });
        onRealtimeEvent?.(payload);
        revalidate();
      }
    );

    channel.subscribe((status: string) => {
      if (!isMounted) return;
      if (status === 'SUBSCRIBED') {
        setConnectionState('CONNECTED');
        // Mandatory authoritative re-fetch after (re)connect
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

    // Fallback polling - low frequency reconciliation
    if (fallbackIntervalMs > 0) {
      fallbackRef.current = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          revalidate();
        }
      }, fallbackIntervalMs);
    }

    // Visibility handling
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Ensure subscription active and reconcile
        if (channelRef.current) {
          revalidate();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', revalidate);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', revalidate);
      if (fallbackRef.current) clearInterval(fallbackRef.current);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current as unknown as never);
        channelRef.current = null;
      }
      setConnectionState('DISCONNECTED');
    };
  }, [channelName, table, filter, event, enabled, restaurantId, fallbackIntervalMs, revalidate, onRealtimeEvent]);

  return { connectionState, revalidate };
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Phase 4A — Landing-page freshness without realtime weight.
 *
 * The pre-join landing page has no ticket identity, so the narrowly-scoped
 * ticket broadcast hook (`useCustomerQueueRealtime`) does not apply.
 * Instead this revalidates the server-rendered status on an interval —
 * presentation only. Join authorization ALWAYS happens server-side in
 * `join_queue_atomic`, so a stale card can never grant a join.
 */
export function LandingAutoRefresh({ intervalMs = 45000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return;
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        try {
          router.refresh();
        } catch {
          /* refresh is best-effort; page stays fully functional */
        }
      }
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}

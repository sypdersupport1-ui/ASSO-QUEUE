'use client';

import { useCustomerQueueRealtime } from '@/lib/realtime/useCustomerQueueRealtime';

/**
 * Phase 4B — Subtle live-update indicator for the ticket screen.
 *
 * Realtime is delivery infrastructure, not truth: every broadcast only
 * triggers revalidation of authoritative server state (see
 * `useCustomerQueueRealtime`). The indicator stays calm and tiny — it
 * never dominates the ticket, and a lost connection never implies the
 * queue is broken because the polling fallback keeps the ticket fresh.
 */
export function CustomerQueueRealtime({ entryId, isTerminal }: { entryId: string; isTerminal?: boolean }) {
  const { connectionState } = useCustomerQueueRealtime(entryId, !isTerminal);

  if (isTerminal) return null;

  const connected = connectionState === 'CONNECTED';
  const reconnecting = connectionState === 'CONNECTING' || connectionState === 'ERROR';

  return (
    <div className="flex justify-center py-2" role="status" aria-live="polite">
      <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
          {!connected && reconnecting && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:animate-none" />
          )}
          <span
            className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-400' : reconnecting ? 'bg-amber-400' : 'bg-slate-600'
            } ${connected ? 'motion-safe:animate-pulse' : ''}`}
          />
        </span>
        {connected ? 'Live updates · Connected' : reconnecting ? 'Reconnecting…' : 'Updates paused · ticket still valid'}
      </p>
    </div>
  );
}

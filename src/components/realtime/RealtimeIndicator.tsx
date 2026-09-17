'use client';

import type { RealtimeConnectionState } from '@/lib/realtime/types';

export function RealtimeIndicator({ state, compact = false }: { state: RealtimeConnectionState; compact?: boolean }) {
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${state === 'CONNECTED' ? 'text-emerald-400' : state === 'CONNECTING' ? 'text-amber-400' : 'text-rose-400'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${state === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : state === 'CONNECTING' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'}`}></span>
        {state === 'CONNECTED' ? 'Live' : state === 'CONNECTING' ? 'Connecting' : 'Offline'}
      </span>
    );
  }

  const config = {
    CONNECTED: { dot: 'bg-emerald-400 animate-pulse', text: '● Live', cls: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' },
    CONNECTING: { dot: 'bg-amber-400 animate-pulse', text: '○ Reconnecting…', cls: 'text-amber-400 border-amber-500/20 bg-amber-500/10' },
    DISCONNECTED: { dot: 'bg-slate-400', text: '○ Reconnecting…', cls: 'text-slate-400 border-white/10 bg-white/5' },
    ERROR: { dot: 'bg-rose-500', text: '⚠ Connection lost', cls: 'text-rose-400 border-rose-500/20 bg-rose-500/10' },
  }[state];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest ${config.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
      {config.text}
    </span>
  );
}

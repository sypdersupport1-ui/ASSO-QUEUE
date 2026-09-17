import React from 'react';

/**
 * Phase 4A — QR landing skeleton. Mirrors the real page structure
 * (header → status card → form card) so load never flashes blank white.
 */
export function CustomerPageSkeleton() {
  return (
    <div
      aria-label="Loading restaurant queue"
      role="status"
      className="qf-bg mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-5 px-4 py-6 sm:py-8"
    >
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className="h-16 w-16 animate-pulse rounded-2xl bg-white/10 sm:h-20 sm:w-20" />
        <div className="h-6 w-48 animate-pulse rounded-full bg-white/10" />
        <div className="h-4 w-32 animate-pulse rounded-full bg-white/5" />
      </div>
      <div className="h-28 animate-pulse rounded-3xl border border-white/10 bg-slate-900/90" />
      <div className="h-96 animate-pulse rounded-3xl border border-white/10 bg-slate-900/90" />
      <div className="h-24 animate-pulse rounded-2xl border border-white/10 bg-slate-900/90" />
      <span className="sr-only">Loading restaurant queue…</span>
    </div>
  );
}

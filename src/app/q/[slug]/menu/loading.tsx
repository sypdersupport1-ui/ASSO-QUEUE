import React from 'react';

/**
 * Phase 4G — menu loading skeleton. Mirrors the menu page structure
 * (header → menu bar → search/tabs → item cards) so browsing never
 * flashes blank and layout shift is minimal.
 */
export default function CustomerMenuLoading() {
  return (
    <main className="qf-bg flex min-h-[100dvh] flex-col px-4 py-6 text-slate-100 sm:py-8" aria-label="Loading menu" role="status">
      <div className="mx-auto w-full max-w-md space-y-5">
        <div className="flex flex-col items-center gap-3">
          <div className="h-20 w-20 animate-pulse rounded-3xl bg-white/10" />
          <div className="h-6 w-44 animate-pulse rounded-full bg-white/10" />
        </div>
        <div className="h-20 animate-pulse rounded-3xl bg-white/5" />
        <div className="h-12 animate-pulse rounded-2xl bg-white/5" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-20 animate-pulse rounded-full bg-white/5" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-3xl border border-white/5 bg-white/[0.03] p-3">
            <div className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-2xl bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-white/10" />
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-white/5" />
              <div className="h-4 w-16 animate-pulse rounded-full bg-white/5" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading menu…</span>
    </main>
  );
}

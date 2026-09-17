import React from 'react';

/**
 * Customer order status loading skeleton.
 * Mirrors the single-card order layout cleanly without jarring layout shifts.
 */
export default function CustomerOrderLoading() {
  return (
    <main
      className="qf-bg flex min-h-[100dvh] flex-col justify-between px-4 py-6 text-slate-100 sm:py-8"
      aria-label="Loading your order"
      role="status"
    >
      <div className="mx-auto w-full max-w-md space-y-4 sm:space-y-5">
        {/* Compact header skeleton */}
        <div className="flex items-center gap-3 p-1">
          <div className="h-10 w-10 shrink-0 rounded-2xl bg-white/10 motion-safe:animate-pulse" />
          <div className="space-y-1.5 flex-1">
            <div className="h-4 w-32 rounded-full bg-white/10 motion-safe:animate-pulse" />
            <div className="h-3 w-20 rounded-full bg-white/5 motion-safe:animate-pulse" />
          </div>
        </div>

        {/* Primary order card skeleton */}
        <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-xl text-center space-y-5">
          <div className="space-y-2 flex flex-col items-center">
            <div className="h-5 w-24 rounded-full bg-white/10 motion-safe:animate-pulse" />
            <div className="h-8 w-44 rounded-2xl bg-white/10 motion-safe:animate-pulse my-1" />
            <div className="h-3.5 w-56 rounded-full bg-white/5 motion-safe:animate-pulse" />
          </div>

          <div className="pt-2 border-t border-white/5 space-y-2">
            <div className="h-1.5 w-full rounded-full bg-white/5 motion-safe:animate-pulse" />
          </div>

          <div className="pt-4 border-t border-white/10 space-y-3 text-left">
            <div className="h-3.5 w-24 rounded-full bg-white/10 motion-safe:animate-pulse" />
            <div className="space-y-2">
              <div className="h-8 w-full rounded-xl bg-white/[0.03] motion-safe:animate-pulse" />
              <div className="h-8 w-full rounded-xl bg-white/[0.03] motion-safe:animate-pulse" />
            </div>
            <div className="pt-3 border-t border-white/10 space-y-1.5">
              <div className="flex justify-between">
                <div className="h-3 w-16 rounded bg-white/5" />
                <div className="h-3 w-12 rounded bg-white/5" />
              </div>
              <div className="flex justify-between pt-2 border-t border-white/5">
                <div className="h-4 w-20 rounded bg-white/10" />
                <div className="h-5 w-16 rounded bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading your order…</span>
    </main>
  );
}

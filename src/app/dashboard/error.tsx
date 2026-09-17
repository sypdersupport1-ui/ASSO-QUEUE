'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';

/**
 * Phase 5A — dashboard error boundary. Calm, operational wording for staff:
 * never provider internals, never secrets. Suspended restaurants and
 * temporary outages both land here with a safe recovery path.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Intentionally not forwarded anywhere with internals; server logs
    // already capture the underlying failure with redaction.
  }, [error]);

  const suspended = /not currently active|Access denied/i.test(error?.message || '');

  return (
    <div className="flex min-h-[60dvh] w-full items-center justify-center px-4 py-8">
      <div role="alert" className="w-full max-w-sm space-y-3 rounded-3xl border border-white/10 bg-[#111827] p-8 text-center shadow-2xl">
        <div aria-hidden="true" className="text-4xl">{suspended ? '🔒' : '📡'}</div>
        <h1 className="text-xl font-black tracking-tight text-white">
          {suspended ? 'Restaurant unavailable' : 'Live data temporarily unavailable'}
        </h1>
        <p className="text-[13px] leading-relaxed text-slate-400">
          {suspended
            ? 'This restaurant is not currently active. Please contact your administrator if you need access.'
            : 'We couldn’t load live operations right now. Your queue and tables are unaffected — try again in a moment.'}
        </p>
        {!suspended && (
          <button
            type="button"
            onClick={() => reset()}
            className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-lg transition-all hover:bg-blue-500 active:scale-[0.98]"
          >
            Reconnect
          </button>
        )}
        <Link
          href="/login"
          className="block h-12 w-full content-center rounded-2xl border border-white/10 bg-white/[0.03] text-center text-sm font-bold text-slate-300 transition-colors hover:text-white"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

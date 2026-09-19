import React from 'react';

interface CustomerShellProps {
  children: React.ReactNode;
  className?: string;
  as?: 'main' | 'div';
}

/**
 * Reusable CustomerShell primitive.
 * Provides consistent mobile-first container, safe area padding,
 * and warm, restrained ambient restaurant backdrop.
 */
export function CustomerShell({
  children,
  className = '',
  as: Component = 'main',
}: CustomerShellProps) {
  return (
    <Component className={`qf-bg relative flex min-h-[100dvh] flex-col justify-between overflow-x-hidden text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-100 ${className}`}>
      {/* Subtle ambient lighting with low opacity */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-gradient-to-b from-slate-800/25 via-slate-900/10 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-emerald-500/[0.04] blur-3xl"
      />

      {/* Main content column with mobile-optimized padding */}
      <div className="relative z-10 mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-5 sm:py-7">
        {children}
      </div>

      {/* Shared refined hospitality footer */}
      <footer className="relative z-10 mx-auto w-full max-w-md px-4 pb-6 pt-6 text-center">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span>Powered by</span>
          <span className="font-bold tracking-tight text-emerald-400">QueueFlow</span>
        </p>
      </footer>
    </Component>
  );
}

import React from 'react';

/**
 * Platform Identity Level 1: ASSO / QueueFlow
 *
 * Requirements:
 * - small
 * - premium
 * - clearly visible
 * - consistently positioned
 * - independent of restaurant data
 * - unchanged across all themes
 */
export function CustomerPlatformBrand() {
  return (
    <div className="flex items-center justify-center pt-1 pb-0.5">
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-md shadow-sm select-none"
        aria-label="Powered by ASSO QueueFlow Platform"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">
          ASSO
        </span>
        <span className="text-[10px] text-slate-600 font-light" aria-hidden="true">
          /
        </span>
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--qf-primary)]">
          QueueFlow
        </span>
      </div>
    </div>
  );
}

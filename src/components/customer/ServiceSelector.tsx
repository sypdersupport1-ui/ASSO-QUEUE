'use client';

import React from 'react';
import { UtensilsCrossed, ShoppingBag } from 'lucide-react';

interface ServiceSelectorProps {
  /** null = no selection yet (initial state for plain QR scans) */
  selectedService: 'DINE_IN' | 'TAKEAWAY' | null;
  onSelectService: (service: 'DINE_IN' | 'TAKEAWAY') => void;
}

/**
 * Mobile-first Service Selection (Dine-In vs Takeaway).
 * High-contrast, large touch targets (>= 100px), tactile feedback,
 * distinct color identities (Dine-In in refined blue, Takeaway in warm amber),
 * and full keyboard/screen-reader accessibility.
 */
export function ServiceSelector({
  selectedService,
  onSelectService,
}: ServiceSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="text-center space-y-1">
        <h2 className="font-luxury-serif text-lg sm:text-xl font-normal tracking-wide text-[#fff9f0]">
          How would you like to dine?
        </h2>
        <p className="text-xs text-[var(--qf-text-secondary)]/85 font-normal">
          Choose a service below to save your spot in line.
        </p>
      </div>

      <div
        className="grid grid-cols-2 gap-3 pt-1"
        role="radiogroup"
        aria-label="Service options"
      >
        {/* Dine-In Option */}
        <button
          type="button"
          role="radio"
          aria-checked={selectedService === 'DINE_IN'}
          tabIndex={0}
          onClick={() => onSelectService('DINE_IN')}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              onSelectService('DINE_IN');
            }
          }}
          className={`group relative flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 active:scale-[0.98] cursor-pointer text-center min-h-[110px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qf-accent-dine-in)] ${
            selectedService === 'DINE_IN'
              ? 'border-[var(--qf-accent-dine-in)]/80 border-t-blue-400/40 bg-[var(--qf-accent-dine-in-glow)] shadow-md shadow-blue-500/10 text-white'
              : 'border-[var(--qf-border)] border-t-white/[0.12] bg-white/[0.025] hover:border-[var(--qf-border-hover)] hover:bg-white/[0.05] text-slate-300 hover:text-white'
          }`}
        >
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl mb-2 transition-all duration-200 ${
              selectedService === 'DINE_IN'
                ? 'bg-[var(--qf-accent-dine-in)] text-white shadow-sm'
                : 'bg-white/[0.04] border border-white/10 text-[var(--qf-text-secondary)] group-hover:text-white'
            }`}
          >
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <span className="text-xs sm:text-sm font-black tracking-wider uppercase">
            Dine-In
          </span>
          <span className="text-[11px] text-[var(--qf-text-secondary)]/80 mt-0.5 leading-tight">
            Table service inside
          </span>
        </button>

        {/* Takeaway Option */}
        <button
          type="button"
          role="radio"
          aria-checked={selectedService === 'TAKEAWAY'}
          tabIndex={0}
          onClick={() => onSelectService('TAKEAWAY')}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              onSelectService('TAKEAWAY');
            }
          }}
          className={`group relative flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 active:scale-[0.98] cursor-pointer text-center min-h-[110px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qf-accent-takeaway)] ${
            selectedService === 'TAKEAWAY'
              ? 'border-[var(--qf-accent-takeaway)]/80 border-t-amber-400/40 bg-[var(--qf-accent-takeaway-glow)] shadow-md shadow-amber-500/10 text-white'
              : 'border-[var(--qf-border)] border-t-white/[0.12] bg-white/[0.025] hover:border-[var(--qf-border-hover)] hover:bg-white/[0.05] text-slate-300 hover:text-white'
          }`}
        >
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl mb-2 transition-all duration-200 ${
              selectedService === 'TAKEAWAY'
                ? 'bg-[var(--qf-accent-takeaway)] text-slate-950 shadow-sm font-bold'
                : 'bg-white/[0.04] border border-white/10 text-[var(--qf-text-secondary)] group-hover:text-white'
            }`}
          >
            <ShoppingBag className="h-5 w-5" />
          </div>
          <span className="text-xs sm:text-sm font-black tracking-wider uppercase">
            Takeaway
          </span>
          <span className="text-[11px] text-[var(--qf-text-secondary)]/80 mt-0.5 leading-tight">
            Order &amp; collect
          </span>
        </button>
      </div>
    </div>
  );
}


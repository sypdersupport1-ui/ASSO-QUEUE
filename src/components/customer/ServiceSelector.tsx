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
          className={`group flex flex-col items-center justify-center p-4 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer text-center min-h-[110px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qf-accent-dine-in)] ${
            selectedService === 'DINE_IN'
              ? 'border-[var(--qf-accent-dine-in)] bg-[var(--qf-accent-dine-in-glow)] shadow-lg text-white ring-1 ring-[var(--qf-accent-dine-in)]/40'
              : 'border-[var(--qf-border)] bg-[var(--qf-surface)]/60 hover:border-[var(--qf-border-hover)] hover:bg-[var(--qf-surface)] text-slate-300 hover:text-white'
          }`}
        >
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl mb-2 transition-all ${
              selectedService === 'DINE_IN'
                ? 'bg-[var(--qf-accent-dine-in)] text-white shadow-md shadow-orange-950/40'
                : 'bg-white/[0.04] border border-white/10 text-amber-200/90'
            }`}
          >
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <span className="text-xs sm:text-sm font-black tracking-wider uppercase">
            Dine-In
          </span>
          <span className="text-[11px] text-[var(--qf-text-secondary)]/75 mt-0.5 leading-tight">
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
          className={`group flex flex-col items-center justify-center p-4 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer text-center min-h-[110px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qf-accent-takeaway)] ${
            selectedService === 'TAKEAWAY'
              ? 'border-[var(--qf-accent-takeaway)] bg-[var(--qf-accent-takeaway-glow)] shadow-lg text-white ring-1 ring-[var(--qf-accent-takeaway)]/40'
              : 'border-[var(--qf-border)] bg-[var(--qf-surface)]/60 hover:border-[var(--qf-border-hover)] hover:bg-[var(--qf-surface)] text-slate-300 hover:text-white'
          }`}
        >
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl mb-2 transition-all ${
              selectedService === 'TAKEAWAY'
                ? 'bg-[var(--qf-accent-takeaway)] text-[#140602] shadow-md shadow-amber-950/40 font-bold'
                : 'bg-white/[0.04] border border-white/10 text-amber-200/90'
            }`}
          >
            <ShoppingBag className="h-5 w-5" />
          </div>
          <span className="text-xs sm:text-sm font-black tracking-wider uppercase">
            Takeaway
          </span>
          <span className="text-[11px] text-[var(--qf-text-secondary)]/75 mt-0.5 leading-tight">
            Order &amp; collect
          </span>
        </button>
      </div>
    </div>
  );
}


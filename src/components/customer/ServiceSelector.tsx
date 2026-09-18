'use client';

import React from 'react';
import { UtensilsCrossed, ShoppingBag } from 'lucide-react';

interface ServiceSelectorProps {
  /** null = no selection yet (initial state for plain QR scans) */
  selectedService: 'DINE_IN' | 'TAKEAWAY' | null;
  onSelectService: (service: 'DINE_IN' | 'TAKEAWAY') => void;
}

/**
 * Phase 2 — Mobile-first Service Selection (Dine-In vs Takeaway).
 * High-contrast, large 56px touch targets, clear distinction.
 */
export function ServiceSelector({
  selectedService,
  onSelectService,
}: ServiceSelectorProps) {
  return (
    <section
      aria-label="Choose dining service"
      className="space-y-2.5 rounded-3xl border border-white/10 bg-slate-900/90 p-4 sm:p-5 shadow-2xl backdrop-blur-xl"
    >
      <div className="text-center">
        <h2 className="text-sm sm:text-base font-black tracking-tight text-white">
          How would you like to order?
        </h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Select an option below to proceed
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 pt-1" role="radiogroup" aria-label="Service type">
        {/* Dine-In Option */}
        <button
          type="button"
          role="radio"
          aria-checked={selectedService === 'DINE_IN'}
          onClick={() => onSelectService('DINE_IN')}
          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer text-center min-h-[96px] ${
            selectedService === 'DINE_IN'
              ? 'border-emerald-500/50 bg-gradient-to-b from-emerald-500/20 to-emerald-950/40 shadow-lg shadow-emerald-500/10 text-white'
              : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white'
          }`}
        >
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-xl mb-1.5 transition-colors ${
              selectedService === 'DINE_IN'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                : 'bg-white/10 text-slate-300'
            }`}
          >
            <UtensilsCrossed className="h-4 w-4" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Dine-In</span>
          <span className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            Sit inside
          </span>
        </button>

        {/* Takeaway Option */}
        <button
          type="button"
          role="radio"
          aria-checked={selectedService === 'TAKEAWAY'}
          onClick={() => onSelectService('TAKEAWAY')}
          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer text-center min-h-[96px] ${
            selectedService === 'TAKEAWAY'
              ? 'border-emerald-500/50 bg-gradient-to-b from-emerald-500/20 to-emerald-950/40 shadow-lg shadow-emerald-500/10 text-white'
              : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white'
          }`}
        >
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-xl mb-1.5 transition-colors ${
              selectedService === 'TAKEAWAY'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                : 'bg-white/10 text-slate-300'
            }`}
          >
            <ShoppingBag className="h-4 w-4" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Takeaway</span>
          <span className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            Order &amp; collect
          </span>
        </button>
      </div>
    </section>
  );
}

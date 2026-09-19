import React from 'react';
import { Minus, Plus, Users } from 'lucide-react';

interface PartySizeSelectorProps {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  error?: string;
  onChange: (next: number) => void;
}

/**
 * Accessible party-size stepper.
 * Large touch targets (>= 48px), keyboard accessible,
 * live value announcements, and clean hospitality aesthetics.
 */
export function PartySizeSelector({
  value,
  min,
  max,
  disabled,
  error,
  onChange,
}: PartySizeSelectorProps) {
  const describedBy = error ? 'party-size-error party-size-hint' : 'party-size-hint';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label id="party-size-label" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
          Party Size <span aria-hidden="true" className="text-emerald-400">*</span>
        </label>
        <span id="party-size-hint" className="text-[11px] text-slate-500 font-normal">
          {min === max ? `${min} guests max` : `${min}–${max} guests`}
        </span>
      </div>

      <div
        role="group"
        aria-labelledby="party-size-label"
        aria-describedby={describedBy}
        className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0e1420] p-2.5 sm:p-3"
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
          aria-label="Decrease party size by one"
          className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200 transition-all hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <Minus aria-hidden="true" className="h-4 w-4" />
        </button>

        <div className="flex-1 text-center select-none" aria-live="polite" aria-atomic="true">
          <p className="flex items-center justify-center gap-2 text-2xl sm:text-3xl font-black tabular-nums text-white">
            {value}
            <Users aria-hidden="true" className="h-4 w-4 text-emerald-400 shrink-0" />
          </p>
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-emerald-400">
            {value === 1 ? '1 Guest' : `${value} Guests`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={disabled || value >= max}
          aria-label="Increase party size by one"
          className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 transition-all hover:bg-emerald-500/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p id="party-size-error" role="alert" className="text-xs font-semibold text-rose-300 pl-1">
          {error}
        </p>
      )}
    </div>
  );
}


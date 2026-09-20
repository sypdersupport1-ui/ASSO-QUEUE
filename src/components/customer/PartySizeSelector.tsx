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
        <label id="party-size-label" className="block text-xs font-bold uppercase tracking-wider text-slate-200">
          Party Size
        </label>
        <span id="party-size-hint" className="text-[11px] text-slate-400 font-medium">
          How many are dining?
        </span>
      </div>

      <div
        role="group"
        aria-labelledby="party-size-label"
        aria-describedby={describedBy}
        className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-2.5 sm:p-3"
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
          aria-label="Decrease party size by one"
          className="customer-glass-control flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl text-slate-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <Minus aria-hidden="true" className="h-4 w-4" />
        </button>

        <div className="flex-1 text-center select-none" aria-live="polite" aria-atomic="true">
          <p className="flex items-center justify-center gap-2 text-2xl sm:text-3xl font-black tabular-nums text-white">
            {value}
            <Users aria-hidden="true" className="h-4 w-4 text-[var(--qf-primary)] shrink-0" />
          </p>
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-[var(--qf-primary)]">
            {value === 1 ? '1 Guest' : `${value} Guests`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={disabled || value >= max}
          aria-label="Increase party size by one"
          className="customer-glass-control flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl border border-[var(--qf-primary)]/30 bg-[var(--qf-primary-glow)] text-[var(--qf-primary)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qf-primary)]"
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


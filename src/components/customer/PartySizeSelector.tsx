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
 * Phase 4A — Accessible party-size stepper.
 * Large 48px touch targets, keyboard-operable native buttons,
 * announced value via aria-live, range communicated in text (no color-only).
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
    <div>
      <span id="party-size-label" className="mb-2 block text-center text-xs font-bold uppercase tracking-widest text-white">
        How many people?
      </span>
      <div
        role="group"
        aria-labelledby="party-size-label"
        aria-describedby={describedBy}
        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3"
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
          aria-label="One fewer person"
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-900 shadow transition-all hover:bg-slate-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-20"
        >
          <Minus aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="flex-1 text-center" aria-live="polite" aria-atomic="true">
          <p className="flex items-center justify-center gap-2 text-3xl font-black tabular-nums text-white">
            {value}
            <Users aria-hidden="true" className="h-5 w-5 text-emerald-400" />
          </p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
            {value === 1 ? '1 guest' : `${value} guests`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={disabled || value >= max}
          aria-label="One more person"
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-white shadow shadow-emerald-500/20 transition-all hover:bg-emerald-400 active:scale-90 disabled:cursor-not-allowed disabled:opacity-20"
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <p id="party-size-hint" className="mt-1.5 text-center text-[11px] font-semibold text-slate-500">
        {min === max ? `This queue accepts parties of ${min}` : `This queue accepts ${min}–${max} guests`}
      </p>
      {error && (
        <p id="party-size-error" role="alert" className="mt-1 text-center text-xs font-semibold text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

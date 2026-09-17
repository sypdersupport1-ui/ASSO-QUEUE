'use client';

import React, { useState } from 'react';
import { Clock, X, Check, Loader2 } from 'lucide-react';

interface CallDelaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (delayMinutes: number) => Promise<void>;
  isSubmitting?: boolean;
}

export function CallDelaySheet({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
}: CallDelaySheetProps) {
  const [selectedMinutes, setSelectedMinutes] = useState(10);
  const delayOptions = [5, 10, 15];

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-delay-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm motion-safe:animate-fadeIn"
    >
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-5 motion-safe:animate-slideUp"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h3 id="call-delay-title" className="text-base font-black text-white">
                Need a little more time?
              </h3>
              <p className="text-xs text-slate-400">
                We&apos;ll notify the host stand to hold your table.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            aria-label="Close delay sheet"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Duration selection */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2.5">
            How much time do you need?
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {delayOptions.map((mins) => {
              const isSelected = selectedMinutes === mins;
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setSelectedMinutes(mins)}
                  disabled={isSubmitting}
                  className={`min-h-[52px] flex flex-col items-center justify-center rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/20 text-amber-200 shadow-md shadow-amber-500/20 ring-1 ring-amber-500/40'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10'
                  }`}
                >
                  <span className="text-base font-black font-mono">{mins} min</span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {mins === 5 ? 'Almost there' : mins === 10 ? 'Standard' : 'Extended'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={() => onSubmit(selectedMinutes)}
            disabled={isSubmitting}
            className="w-full min-h-[48px] h-12 flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-black shadow-lg shadow-amber-500/20 transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Requesting delay…</span>
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                <span>Request {selectedMinutes} Min Delay</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full min-h-[44px] py-2.5 text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Never mind, I&apos;ll be right there
          </button>
        </div>
      </div>
    </div>
  );
}

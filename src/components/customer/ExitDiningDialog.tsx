'use client';

import React, { useState, useTransition, useRef, useEffect } from 'react';
import { CheckCircle2, LoaderCircle, UtensilsCrossed, LogOut, PlusCircle } from 'lucide-react';
import { exitDiningCustomerAction } from '@/app/q/actions';

interface ExitDiningDialogProps {
  token: string;
  restaurantSlug: string;
}

export function ExitDiningDialog({ token, restaurantSlug }: ExitDiningDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      confirmRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handleExit = (startNewTicket = false) => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        await exitDiningCustomerAction(token, restaurantSlug, 'landing');
        window.location.href = `/q/${restaurantSlug}?${startNewTicket ? 'new_entry=1' : 'left_queue=1'}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (
          msg.includes('NEXT_REDIRECT') ||
          (err && typeof err === 'object' && 'digest' in err && String((err as { digest?: string }).digest).startsWith('NEXT_REDIRECT'))
        ) {
          window.location.href = `/q/${restaurantSlug}?${startNewTicket ? 'new_entry=1' : 'left_queue=1'}`;
          return;
        }
        // Even on network error, ensure client redirect so user is never trapped
        window.location.href = `/q/${restaurantSlug}?${startNewTicket ? 'new_entry=1' : 'left_queue=1'}`;
      }
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="customer-glass-control flex h-13 min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-[var(--qf-primary)]/30 bg-[var(--qf-primary)]/10 text-sm font-bold text-[var(--qf-primary)] transition-all hover:border-[var(--qf-primary)]/50 hover:bg-[var(--qf-primary)]/20 hover:text-white active:scale-[0.98] cursor-pointer shadow-lg"
        aria-haspopup="dialog"
      >
        <LogOut aria-hidden="true" className="h-4 w-4 text-[var(--qf-primary)]" />
        <span>Leave Queue / Done Dining</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-dining-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="customer-glass-card w-full max-w-sm rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/95 backdrop-blur-xl p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--qf-primary)]/15 border border-[var(--qf-primary)]/30 text-[var(--qf-primary)]">
                <UtensilsCrossed className="h-6 w-6" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 id="exit-dining-title" className="text-lg font-black text-white">
                  Finished Dining?
                </h3>
                <p className="text-xs leading-relaxed text-slate-400">
                  This will complete your ticket and exit the queue flow. You can return and join the queue again whenever you are hungry!
                </p>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-center text-xs text-rose-300">
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                ref={confirmRef}
                type="button"
                disabled={isPending}
                onClick={() => handleExit(false)}
                className="customer-primary-cta flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black shadow-lg active:scale-[0.99] cursor-pointer disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    <span>Exiting Queue...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Yes, Leave Queue &amp; Finish</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isPending}
                onClick={() => handleExit(true)}
                className="flex min-h-[44px] h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 text-xs font-bold text-slate-200 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <PlusCircle className="h-4 w-4 text-[var(--qf-primary)]" />
                <span>Leave &amp; Join Again (Next Meal)</span>
              </button>

              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsOpen(false)}
                className="flex min-h-[44px] h-11 w-full items-center justify-center rounded-2xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Still Dining / Stay on Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

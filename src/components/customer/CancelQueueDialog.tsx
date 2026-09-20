'use client';

import React, { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, LoaderCircle, TriangleAlert, RefreshCw } from 'lucide-react';
import { cancelQueuePublicAction } from '@/app/q/actions';

interface CancelQueueDialogProps {
  token: string;
  restaurantSlug: string;
}

/**
 * Phase 4B — Cancellation stays secondary but accessible.
 *
 * Security: uses the existing secure path (`cancelQueuePublicAction` →
 * token-hash lookup → tenant cross-check → anon CANCELLED-only atomic
 * RPC). No entry/restaurant ids are sent as authorization; the raw token
 * prop is never written to browser storage. Duplicate taps are blocked
 * while the transition is pending.
 *
 * Phase 4F — ambiguous-failure recovery: a failed request NEVER claims a
 * result. Network loss, timeouts, and staff races (call/seat/no-show won
 * first) all land in the same calm error with two safe exits:
 * "Check my ticket" re-reads authoritative state with zero side effects
 * (router.refresh), and "Try again" re-runs the idempotent secure action.
 * The retry is safe even if the first request actually succeeded with a
 * lost response: re-cancelling an already-CANCELLED ticket is an
 * idempotent no-op that lands on the same cancelled state.
 */
export function CancelQueueDialog({ token, restaurantSlug }: CancelQueueDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isChecking, setIsChecking] = useState(false);
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

  const handleCancel = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        await cancelQueuePublicAction(token, restaurantSlug);
        // Success redirects server-side; dialog unmounts with the page.
      } catch {
        // Ambiguous failure: network loss, timeout, rate limit, or a staff
        // race (call/seat/no-show won first). Never claim success or
        // failure — the error box below offers revalidation + safe retry.
        // Never leak internals.
        setError('leave-ambiguous');
      }
    });
  };

  // Zero-side-effect recovery: re-read authoritative ticket state.
  const handleCheckTicket = () => {
    if (isChecking) return;
    setIsChecking(true);
    try {
      router.refresh();
    } finally {
      // The refresh remounts server state; close the dialog so the true
      // ticket state is fully visible. Fallback timers reconcile anyway.
      setIsOpen(false);
      setIsChecking(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="customer-glass-control flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-[var(--qf-border)] bg-white/[0.03] text-sm font-bold text-slate-400 transition-colors hover:border-[var(--qf-danger)]/30 hover:text-[var(--qf-danger)] cursor-pointer"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        Leave queue
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!isPending) setIsOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-title"
            aria-describedby="cancel-dialog-desc"
            className="customer-glass-card qf-cancel-dialog w-full max-w-sm space-y-5 rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/95 backdrop-blur-xl p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <TriangleAlert aria-hidden="true" className="mx-auto h-9 w-9 text-[var(--qf-warning)]" />
            <div className="space-y-1.5">
              <h3 id="cancel-dialog-title" className="text-lg font-bold text-white">
                Leave the queue?
              </h3>
              <p id="cancel-dialog-desc" className="text-[13px] leading-relaxed text-slate-400">
                You&apos;ll lose your place and won&apos;t be able to recover
                this ticket. If your table is close, consider staying.
              </p>
            </div>

            {error && (
              <div role="alert" className="space-y-2.5 rounded-2xl border border-[var(--qf-warning)]/30 bg-[var(--qf-warning)]/10 px-3.5 py-3 text-left">
                <p className="text-xs font-bold leading-relaxed text-[var(--qf-warning)]">
                  We couldn&apos;t confirm leaving the queue.
                </p>
                <p className="text-[11px] leading-relaxed text-slate-300">
                  Your ticket may have just changed, or the connection dropped. Nothing is assumed — check the live ticket to see the truth.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCheckTicket}
                    disabled={isPending || isChecking}
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-[11px] font-black text-slate-900 transition-all hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    Check my ticket
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isPending || isChecking}
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 text-[11px] font-black text-white transition-all hover:bg-white/10 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                  >
                    {isPending && <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
                    Try again
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
                className="h-12 flex-1 rounded-2xl bg-white/5 border border-white/10 text-xs font-bold text-white transition-colors hover:bg-white/10 disabled:opacity-50 cursor-pointer"
              >
                Keep my place
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                aria-busy={isPending}
                className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[var(--qf-danger)] text-xs font-bold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              >
                {isPending && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
                {isPending ? 'Leaving…' : 'Leave queue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

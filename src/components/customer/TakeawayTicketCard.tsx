'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShoppingBag,
  CheckCircle2,
  Volume2,
  Check,
  X,
  LoaderCircle,
  AlertTriangle,
  UtensilsCrossed,
  ArrowRight,
} from 'lucide-react';
import type { PublicQueueStatusResponse } from '@/lib/services/queue-service';
import { formatTakeawayTicketNumber } from '@/lib/customer-ticket-ux';
import { cancelQueuePublicAction } from '@/app/q/actions';
import { chimeEngine } from '@/lib/audio-chime';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';

interface TakeawayOrderItem {
  name: string;
  quantity: number;
  totalPrice: number;
}

interface TakeawayOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  items: TakeawayOrderItem[];
}

interface TakeawayTicketCardProps {
  status: PublicQueueStatusResponse;
  token: string;
  restaurantSlug: string;
  restaurantName?: string;
  orders?: TakeawayOrderSummary[];
  currency?: string;
}

/**
 * Phase 2 — Customer Takeaway Ticket Card.
 *
 * Takeaway is strictly an ORDER + PICKUP queue (never a seating queue).
 * Customer-facing states:
 * 1. IN QUEUE
 * 2. CALLING (YOUR ORDER IS READY)
 * 3. COMPLETED (ORDER COLLECTED)
 *
 * Guaranteed ZERO mentions of:
 * - Party size
 * - Table ready / Table number
 * - Table recommendation / Table assignment
 * - Seating / Seated / Floor
 */
export function TakeawayTicketCard({
  status,
  token,
  restaurantSlug,
  restaurantName,
  orders = [],
  currency = 'INR',
}: TakeawayTicketCardProps) {
  const router = useRouter();
  const ticketNo = formatTakeawayTicketNumber(status.displayNumber, status.entryId);

  const isCompleted = Boolean(status.completedAt) || status.status === 'COMPLETED';
  const isCalled = status.status === 'CALLED';
  const isCancelled = status.status === 'CANCELLED';
  const isExpired = status.status === 'NO_SHOW' || status.status === 'EXPIRED';
  const isInQueue = (status.status === 'WAITING' || status.status === 'NOTIFIED') && !isCompleted;

  // Track status transitions for audible buzzer & screen announcements
  const prevStatusRef = useRef(status.status);
  const prevPositionRef = useRef(status.position);

  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [buzzerTested, setBuzzerTested] = useState(false);
  const [atCounterConfirmed, setAtCounterConfirmed] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Format currency
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const formatPrice = (amount: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `₹${amount.toFixed(2)}`;
    }
  };

  // Sound and vibration triggers on status transitions
  useEffect(() => {
    if (prevStatusRef.current !== status.status) {
      if (status.status === 'CALLED') {
        chimeEngine.playBuzzerSound();
        setLiveAnnouncement('Your takeaway order is ready! Please proceed to the takeaway counter.');
        try {
          if ('vibrate' in navigator) {
            navigator.vibrate([300, 100, 300, 100, 400]);
          }
        } catch {}
      } else if (isCompleted) {
        chimeEngine.playSeatChime();
        setLiveAnnouncement('Order collected. Thank you for ordering takeaway!');
      } else {
        setLiveAnnouncement(`Your takeaway order is in the queue. Ticket ${ticketNo}.`);
      }
      prevStatusRef.current = status.status;
    } else if (
      status.position !== null &&
      prevPositionRef.current !== null &&
      status.position < prevPositionRef.current
    ) {
      // Position moved closer
      chimeEngine.playBuzzerSound();
    }
    prevPositionRef.current = status.position;
  }, [status.status, status.position, ticketNo, isCompleted]);

  // Primary active order (if any)
  const activeOrder = orders[0] || null;

  // Handle "I'm at the counter" acknowledge
  const handleAtCounter = async () => {
    setAtCounterConfirmed(true);
    setLiveAnnouncement("Staff notified that you're at the takeaway counter.");
    try {
      await fetch('/api/q/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          restaurantSlug,
          response: 'ACCEPTED',
        }),
      });
      await broadcastCustomerQueueUpdate(status.entryId);
      router.refresh();
    } catch {}
  };

  // Handle Takeaway Cancellation
  const handleCancelQueue = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancelQueuePublicAction(token, restaurantSlug);
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel order.');
      setIsCancelling(false);
    }
  };

  return (
    <section
      aria-label={`Takeaway ticket ${ticketNo}`}
      className="qf-card relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 p-5 sm:p-7 shadow-2xl text-center backdrop-blur-xl space-y-5"
    >
      {/* Ambient background illumination */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-60 w-60 rounded-full bg-emerald-500/15 blur-3xl"
      />
      {isCalled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-emerald-500/10 blur-2xl motion-safe:animate-pulse"
        />
      )}

      {/* Screen-reader live announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* 1. TICKET HEADER & BADGES */}
      <div className="relative z-10 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-400">
            <ShoppingBag className="h-3 w-3" />
            <span>Takeaway</span>
          </span>

          {isInQueue && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span>In Queue</span>
            </span>
          )}

          {isCalled && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-amber-300 animate-pulse">
              <span>● Calling</span>
            </span>
          )}

          {isCompleted && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-300">
              <Check className="h-3 w-3" />
              <span>Completed</span>
            </span>
          )}
        </div>

        {/* Large high-impact ticket number (T-08) */}
        <h1
          aria-label={`Your takeaway ticket number is ${ticketNo}`}
          className="font-mono text-6xl sm:text-7xl font-black tracking-tight text-white tabular-nums drop-shadow-md my-1 motion-safe:animate-numberPop"
        >
          {ticketNo}
        </h1>

        {/* Guest & restaurant badges (NO party size) */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-xs">
          {restaurantName && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-slate-300 max-w-[220px] truncate">
              {restaurantName}
            </span>
          )}
          {status.customerName && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300">
              <span>{status.customerName}</span>
            </span>
          )}
        </div>
      </div>

      {/* 2. STATE PRESENTATION */}

      {/* STATE 1: IN QUEUE */}
      {isInQueue && (
        <div className="relative z-10 space-y-4 pt-1">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-black text-white">
              Your takeaway order is in the queue.
            </h2>
            <p className="text-xs text-slate-400">
              We&apos;ll let you know when it&apos;s time to collect.
            </p>
          </div>

          {/* Position & Orders Ahead Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Position */}
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-teal-500/5 to-slate-900/60 p-3.5 text-center shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-0.5">
                Position
              </p>
              <p className="font-mono text-3xl sm:text-4xl font-black text-emerald-300 tabular-nums">
                {status.position === 1 ? 'Next' : status.position ?? '—'}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                {status.position === 1 ? 'You are first in queue' : 'In takeaway line'}
              </p>
            </div>

            {/* People / Orders Ahead */}
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-slate-900/60 p-3.5 text-center shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-0.5">
                Ahead of You
              </p>
              <p className="font-mono text-3xl sm:text-4xl font-black text-amber-300 tabular-nums">
                {status.peopleAhead !== null && status.peopleAhead >= 0
                  ? status.peopleAhead
                  : '0'}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                {status.peopleAhead === 1 ? '1 ahead' : `${status.peopleAhead ?? 0} ahead`}
              </p>
            </div>
          </div>

          {/* Linear Stepper */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5 px-0.5">
              <span className="inline-flex items-center gap-1 font-extrabold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> In Queue
              </span>
              <span className="text-slate-500">Calling</span>
              <span className="text-slate-500">Completed</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full w-1/3 transition-all duration-500 shadow-sm shadow-emerald-500/50" />
            </div>
          </div>

          {/* Test Loud Buzzer Button */}
          <button
            type="button"
            onClick={() => {
              chimeEngine.playBuzzerSound();
              setBuzzerTested(true);
              setTimeout(() => setBuzzerTested(false), 2200);
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer shadow-sm"
          >
            <Volume2 className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{buzzerTested ? 'Buzzer ringing loud! 🔊' : 'Test Loud Buzzer Sound'}</span>
          </button>
        </div>
      )}

      {/* STATE 2: CALLING (YOUR ORDER IS READY) */}
      {isCalled && !isCompleted && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="rounded-2xl border border-amber-500/50 bg-gradient-to-br from-amber-500/25 via-emerald-950/30 to-slate-900/90 p-5 text-center shadow-xl space-y-2">
            <span className="text-3xl" aria-hidden="true">📢</span>
            <h2 className="text-2xl sm:text-3xl font-black text-amber-300 tracking-tight">
              YOUR ORDER IS READY
            </h2>
            <p className="text-xs sm:text-sm font-bold text-slate-200">
              Ticket {ticketNo} — Please proceed to the takeaway counter.
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              Show your ticket to the staff and pay at the counter.
            </p>
          </div>

          {/* Linear Stepper at Calling */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5 px-0.5">
              <span className="text-emerald-400">In Queue</span>
              <span className="inline-flex items-center gap-1 font-extrabold text-amber-300 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Calling
              </span>
              <span className="text-slate-500">Completed</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 rounded-full w-2/3 transition-all duration-500 shadow-sm" />
            </div>
          </div>

          <button
            type="button"
            onClick={handleAtCounter}
            className="w-full flex h-13 min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm tracking-wide shadow-xl shadow-emerald-500/20 active:scale-[0.99] cursor-pointer transition-all"
          >
            {atCounterConfirmed ? (
              <>
                <Check className="h-4 w-4" />
                <span>Staff Notified — At Counter</span>
              </>
            ) : (
              <>
                <ShoppingBag className="h-4 w-4" />
                <span>I&apos;m at the Counter</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* STATE 3: COMPLETED */}
      {isCompleted && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 to-slate-900/90 p-5 text-center shadow-xl space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">
              ORDER COLLECTED
            </h2>
            <p className="text-sm font-bold text-emerald-300">
              Thanks! Your takeaway order has been completed.
            </p>
            <p className="text-xs text-slate-400">
              We hope you enjoy your meal. Visit us again!
            </p>
          </div>

          <Link
            href={`/q/${restaurantSlug}`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-bold text-white transition-all active:scale-[0.99]"
          >
            <span>Order Again</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* CANCELLED STATE */}
      {isCancelled && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-center space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300 border border-rose-500/30">
              <X className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-black text-rose-200">
              Takeaway Order Cancelled
            </h2>
            <p className="text-xs text-rose-300/90 leading-relaxed">
              Your place in the takeaway queue has been cancelled.
            </p>
          </div>

          <Link
            href={`/q/${restaurantSlug}`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all active:scale-[0.99]"
          >
            <span>Start New Order</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* EXPIRED / NO_SHOW STATE */}
      {isExpired && !isCancelled && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-black text-amber-200">
              Spot Expired
            </h2>
            <p className="text-xs text-amber-300/90 leading-relaxed">
              This takeaway ticket is no longer active. Please speak to the takeaway counter or join again.
            </p>
          </div>

          <Link
            href={`/q/${restaurantSlug}`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all active:scale-[0.99]"
          >
            <span>Join Takeaway Queue Again</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* 3. ATTACHED ORDER OR ORDER PROMPT */}
      {activeOrder ? (
        <div className="relative z-10 pt-3 border-t border-white/10 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Order #{activeOrder.orderNumber}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
              PAY AT COUNTER
            </span>
          </div>

          {/* Line items */}
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 divide-y divide-white/5 space-y-2">
            {activeOrder.items.map((item, idx) => (
              <div key={idx} className="flex justify-between text-xs pt-1.5 first:pt-0">
                <span className="text-slate-200 font-medium">
                  {item.quantity} × {item.name}
                </span>
                <span className="font-mono text-slate-300">
                  {formatPrice(item.totalPrice)}
                </span>
              </div>
            ))}

            <div className="flex justify-between items-baseline pt-2 text-xs font-bold text-white">
              <span>Total Amount</span>
              <span className="font-mono text-sm text-emerald-400">
                {formatPrice(activeOrder.total)}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            💵 <strong className="text-slate-200 uppercase tracking-wider">PAY AT COUNTER</strong> — You can pay when collecting your order.
          </p>
        </div>
      ) : isInQueue ? (
        /* Secondary Flow: Queue joined without ordering online yet */
        <div className="relative z-10 pt-3 border-t border-white/10 text-center space-y-2">
          <p className="text-xs text-slate-300">
            Want to choose your food while waiting?
          </p>
          <Link
            href={`/q/${restaurantSlug}/menu?qtoken=${token}`}
            className="flex min-h-[46px] h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition-all active:scale-[0.99]"
          >
            <UtensilsCrossed className="h-3.5 w-3.5" />
            <span>Browse Menu &amp; Order Now</span>
          </Link>
          <p className="text-[10px] text-slate-400">
            You can also order directly with the staff at the counter when called.
          </p>
        </div>
      ) : null}

      {/* 4. CANCELLATION (ONLY FOR WAITING / CALLING) */}
      {(isInQueue || isCalled) && (
        <div className="relative z-10 pt-2 border-t border-white/10 text-center">
          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            className="text-[11px] font-semibold text-rose-300/80 hover:text-rose-200 underline underline-offset-4 transition-colors cursor-pointer py-1"
          >
            Cancel Takeaway Order
          </button>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center animate-in zoom-in-95">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Cancel Takeaway Order?</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to cancel Ticket {ticketNo}? You will lose your spot in the takeaway queue.
              </p>
            </div>

            {cancelError && (
              <p className="text-xs font-semibold text-rose-300">{cancelError}</p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-200 transition-colors"
              >
                Keep Spot
              </button>
              <button
                type="button"
                disabled={isCancelling}
                onClick={handleCancelQueue}
                className="flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5"
              >
                {isCancelling ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <span>Yes, Cancel</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

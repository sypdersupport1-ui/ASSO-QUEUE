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
  Flame,
  Megaphone,
  Sparkles,
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
  takeawayCustomerOrderingEnabled?: boolean;
  takeawayManualOrderingEnabled?: boolean;
}

/**
 * Customer Takeaway Ticket Card.
 *
 * Takeaway is strictly an ORDER + PICKUP queue (never a seating queue).
 * Customer-facing 4 stages:
 * 1. WAITING
 * 2. CALLED
 * 3. ORDER COMPLETED (preparation begins; READY milestone announces collection)
 * 4. ITEMS RECEIVED (final physical handover, queue entry COMPLETED)
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
  takeawayCustomerOrderingEnabled = true,
  takeawayManualOrderingEnabled = false,
}: TakeawayTicketCardProps) {
  const router = useRouter();
  const ticketNo = formatTakeawayTicketNumber(status.displayNumber, status.entryId);

  // Primary active order (if any)
  const activeOrder = orders[0] || null;

  const isPreparing = activeOrder?.status === 'PREPARING';
  const isReady = activeOrder?.status === 'READY';
  const isOrderServed = activeOrder?.status === 'SERVED';
  const isCompleted = Boolean(status.completedAt) || status.status === 'COMPLETED' || isOrderServed;
  const isCalled = status.status === 'CALLED';
  const isCancelled = status.status === 'CANCELLED';
  const isExpired = status.status === 'NO_SHOW' || status.status === 'EXPIRED';

  // 4-Stage resolution
  let currentStage: 'WAITING' | 'CALLED' | 'ORDER_COMPLETED' | 'ITEMS_RECEIVED' = 'WAITING';
  if (isCompleted) {
    currentStage = 'ITEMS_RECEIVED';
  } else if (isCalled) {
    if (isPreparing || isReady) {
      currentStage = 'ORDER_COMPLETED';
    } else {
      currentStage = 'CALLED';
    }
  } else {
    currentStage = 'WAITING';
  }

  // Track status transitions for audible buzzer & screen announcements
  const prevStatusRef = useRef(status.status);
  const prevOrderStatusRef = useRef(activeOrder?.status);
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
    const prevStatus = prevStatusRef.current;
    const prevOrderStatus = prevOrderStatusRef.current;

    if (prevStatus !== status.status || prevOrderStatus !== activeOrder?.status) {
      if (isCompleted) {
        chimeEngine.playSeatChime();
        setLiveAnnouncement('Items received! Thank you for ordering takeaway.');
      } else if (isReady) {
        chimeEngine.playSeatChime();
        setLiveAnnouncement('Your takeaway order is ready for collection! Please step up to the counter.');
      } else if (isPreparing) {
        chimeEngine.playBuzzerSound();
        setLiveAnnouncement('Order accepted. Preparation has started in the kitchen.');
      } else if (status.status === 'CALLED') {
        chimeEngine.playBuzzerSound();
        setLiveAnnouncement('Your ticket is called! Please proceed to the takeaway counter.');
        try {
          if ('vibrate' in navigator) {
            navigator.vibrate([300, 100, 300, 100, 400]);
          }
        } catch {}
      } else {
        setLiveAnnouncement(`Your takeaway order is in the queue. Ticket ${ticketNo}.`);
      }
      prevStatusRef.current = status.status;
      prevOrderStatusRef.current = activeOrder?.status;
    } else if (
      status.position !== null &&
      prevPositionRef.current !== null &&
      status.position < prevPositionRef.current
    ) {
      // Position moved closer
      chimeEngine.playBuzzerSound();
    }
    prevPositionRef.current = status.position;
  }, [status.status, status.position, activeOrder?.status, ticketNo, isCompleted, isReady, isPreparing]);

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
      className="customer-glass-card relative overflow-hidden p-5 sm:p-7 text-center backdrop-blur-xl space-y-5"
    >
      {/* Ambient background illumination */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-60 w-60 rounded-full blur-3xl opacity-30"
        style={{ background: 'var(--qf-primary-glow)' }}
      />
      {(isCalled || isReady) && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 blur-2xl motion-safe:animate-pulse opacity-20"
          style={{ background: 'var(--qf-primary-glow)' }}
        />
      )}

      {/* Screen-reader live announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* 1. TICKET HEADER & BADGES */}
      <div className="relative z-10 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-accent-takeaway)]/30 bg-[var(--qf-accent-takeaway)]/15 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[var(--qf-accent-takeaway)]">
            <ShoppingBag className="h-3 w-3" />
            <span>Takeaway</span>
          </span>

          {currentStage === 'WAITING' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-border)] bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--qf-success)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--qf-success)]" />
              </span>
              <span>In Queue</span>
            </span>
          )}

          {currentStage === 'CALLED' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-warning)]/40 bg-[var(--qf-warning)]/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[var(--qf-warning)] animate-pulse">
              <span>● Called</span>
            </span>
          )}

          {currentStage === 'ORDER_COMPLETED' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-border)] bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-slate-200">
              {isReady ? (
                <span className="inline-flex items-center gap-1 text-[var(--qf-success)]">
                  <Sparkles className="h-3 w-3 text-[var(--qf-success)]" aria-hidden="true" />
                  <span>Ready for Pickup</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--qf-warning)]">
                  <Flame className="h-3 w-3 text-[var(--qf-warning)]" aria-hidden="true" />
                  <span>Preparing</span>
                </span>
              )}
            </span>
          )}

          {currentStage === 'ITEMS_RECEIVED' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--qf-border)] bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[var(--qf-success)]">
              <Check className="h-3 w-3 text-[var(--qf-success)]" />
              <span>Items Received</span>
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
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--qf-border)] bg-white/5 px-2.5 py-1 font-semibold text-slate-300 max-w-[220px] truncate">
              {restaurantName}
            </span>
          )}
          {status.customerName && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--qf-border)] bg-white/5 px-2.5 py-1 font-semibold text-[var(--qf-primary)]">
              <span>{status.customerName}</span>
            </span>
          )}
        </div>
      </div>

      {/* 4-STAGE LINEAR STEPPER */}
      {!isCancelled && !isExpired && (
        <div className="relative z-10 pt-1">
          <div className="grid grid-cols-4 text-center text-[10px] sm:text-[11px] font-bold mb-1.5 gap-1">
            <span
              className={
                currentStage === 'WAITING'
                  ? 'text-[var(--qf-primary)] font-black'
                  : 'text-[var(--qf-primary)]/80 font-semibold'
              }
            >
              {takeawayManualOrderingEnabled ? '1. In Queue' : '1. Waiting'}
            </span>
            <span
              className={
                currentStage === 'CALLED'
                  ? 'text-[var(--qf-warning)] font-black animate-pulse'
                  : ['ORDER_COMPLETED', 'ITEMS_RECEIVED'].includes(currentStage)
                  ? 'text-[var(--qf-primary)]/80 font-semibold'
                  : 'text-slate-500 font-medium'
              }
            >
              {takeawayManualOrderingEnabled ? '2. Called' : '2. Called'}
            </span>
            <span
              className={
                currentStage === 'ORDER_COMPLETED'
                  ? 'text-[var(--qf-primary)] font-black'
                  : currentStage === 'ITEMS_RECEIVED'
                  ? 'text-[var(--qf-primary)]/80 font-semibold'
                  : 'text-slate-500 font-medium'
              }
            >
              {takeawayManualOrderingEnabled ? '3. Place Order' : '3. Order Completed'}
            </span>
            <span
              className={
                currentStage === 'ITEMS_RECEIVED'
                  ? 'text-[var(--qf-primary)] font-black'
                  : 'text-slate-500 font-medium'
              }
            >
              4. Items Received
            </span>
          </div>
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full rounded-full transition-all duration-500 shadow-sm"
              style={{
                background: 'linear-gradient(to right, var(--qf-primary), var(--qf-accent-takeaway))',
                width:
                  currentStage === 'WAITING'
                    ? '25%'
                    : currentStage === 'CALLED'
                    ? '50%'
                    : currentStage === 'ORDER_COMPLETED'
                    ? '75%'
                    : '100%',
              }}
            />
          </div>
        </div>
      )}

      {/* 2. STATE PRESENTATION */}

      {/* STAGE 1: WAITING */}
      {currentStage === 'WAITING' && !isCancelled && !isExpired && (
        <div className="relative z-10 space-y-4 pt-1">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-black text-white">
              You&apos;re in the takeaway queue.
            </h2>
            <p className="text-xs text-slate-400">
              We&apos;ll call your ticket when it&apos;s your turn at the counter.
            </p>
          </div>

          {/* Position & Orders Ahead Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Position */}
            <div className="customer-glass-surface p-3.5 text-center shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--qf-primary)] mb-0.5">
                Position
              </p>
              <p className="font-mono text-3xl sm:text-4xl font-black text-[var(--qf-primary)] tabular-nums">
                {status.position === 1 ? 'Next' : status.position ?? '—'}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                {status.position === 1 ? 'You are first in queue' : 'In takeaway line'}
              </p>
            </div>

            {/* People / Orders Ahead */}
            <div className="customer-glass-surface p-3.5 text-center shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--qf-accent-takeaway)] mb-0.5">
                Ahead of You
              </p>
              <p className="font-mono text-3xl sm:text-4xl font-black text-[var(--qf-accent-takeaway)] tabular-nums">
                {status.peopleAhead !== null && status.peopleAhead >= 0
                  ? status.peopleAhead
                  : '0'}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                {status.peopleAhead === 1 ? '1 ahead' : `${status.peopleAhead ?? 0} ahead`}
              </p>
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
            className="customer-glass-control w-full flex items-center justify-center gap-2 py-2.5 px-4 text-slate-200 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer shadow-sm"
          >
            <Volume2 className="h-4 w-4 text-[var(--qf-primary)] shrink-0" />
            <span>{buzzerTested ? 'Buzzer ringing loud! 🔊' : 'Test Loud Buzzer Sound'}</span>
          </button>
        </div>
      )}

      {/* STAGE 2: CALLED */}
      {currentStage === 'CALLED' && !isCancelled && !isExpired && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="customer-glass-surface p-5 text-center shadow-xl space-y-3">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-[var(--qf-warning)]/20 text-[var(--qf-warning)] border border-[var(--qf-warning)]/30">
              <Megaphone className="h-6 w-6 text-[var(--qf-warning)]" aria-hidden="true" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-[var(--qf-warning)] tracking-tight">
              YOUR TICKET IS CALLED
            </h2>
            <p className="text-xs sm:text-sm font-bold text-slate-200">
              Ticket {ticketNo} — Please proceed to the takeaway counter.
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              {takeawayManualOrderingEnabled
                ? 'Show your ticket to the staff. Place your order at the counter to begin preparation.'
                : 'Show your ticket to the staff. They will confirm your order and begin preparation.'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleAtCounter}
            className="customer-primary-cta w-full flex h-13 min-h-[52px] items-center justify-center gap-2 rounded-2xl font-black text-sm tracking-wide active:scale-[0.99] cursor-pointer transition-all"
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

      {/* STAGE 3: ORDER COMPLETED (Preparation Started / Ready for Collection) */}
      {currentStage === 'ORDER_COMPLETED' && !isCancelled && !isExpired && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          {isReady ? (
            /* Sub-state: Order is READY for collection */
            <div className="customer-glass-card p-5 text-center shadow-xl space-y-3">
              <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-[var(--qf-success)]/20 text-[var(--qf-success)] border border-[var(--qf-success)]/30">
                <Sparkles className="h-6 w-6 text-[var(--qf-success)]" aria-hidden="true" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-[var(--qf-success)] tracking-tight">
                READY FOR COLLECTION!
              </h2>
              <p className="text-xs sm:text-sm font-bold text-slate-200">
                Ticket {ticketNo} — Your food is packed and ready!
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                Please step up to the takeaway counter to pick up your order.
              </p>
            </div>
          ) : (
            /* Sub-state: Order is PREPARING */
            <div className="customer-glass-surface p-5 text-center shadow-xl space-y-2">
              <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-[var(--qf-warning)]/20 text-[var(--qf-warning)] border border-[var(--qf-warning)]/30">
                <Flame className="h-6 w-6 text-[var(--qf-warning)] animate-pulse" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">
                {takeawayManualOrderingEnabled ? 'ORDER PLACED' : 'ORDER ACCEPTED & PREPARING'}
              </h2>
              <p className="text-xs sm:text-sm font-bold text-[var(--qf-warning)]">
                {takeawayManualOrderingEnabled
                  ? 'Your order has been placed at the counter. Food is being prepared!'
                  : 'Counter acceptance complete. The kitchen is preparing your order.'}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Please wait near the counter. We will notify you the moment your food is packed and ready!
              </p>
            </div>
          )}
        </div>
      )}

      {/* STAGE 4: ITEMS RECEIVED */}
      {currentStage === 'ITEMS_RECEIVED' && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="customer-glass-card p-5 text-center shadow-xl space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-[var(--qf-success)]/20 text-[var(--qf-success)] border border-[var(--qf-success)]/30">
              <CheckCircle2 className="h-6 w-6 text-[var(--qf-success)]" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">
              ITEMS RECEIVED
            </h2>
            <p className="text-sm font-bold text-[var(--qf-success)]">
              Thanks! Your takeaway order has been completed.
            </p>
            <p className="text-xs text-slate-400">
              We hope you enjoy your meal. Visit us again!
            </p>
          </div>

          <Link
            href={`/q/${restaurantSlug}`}
            className="customer-primary-cta flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold text-xs transition-all active:scale-[0.99]"
          >
            <span>Order Again</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* CANCELLED STATE */}
      {isCancelled && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="customer-glass-surface p-5 text-center space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-[var(--qf-danger)]/20 text-rose-300 border border-[var(--qf-danger)]/30">
              <X className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-black text-rose-200">
              Takeaway Ticket Cancelled
            </h2>
            <p className="text-xs text-rose-300/90 leading-relaxed">
              Your place in the takeaway queue has been cancelled.
            </p>
          </div>

          <Link
            href={`/q/${restaurantSlug}`}
            className="customer-primary-cta flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold text-xs transition-all active:scale-[0.99]"
          >
            <span>Join Takeaway Queue Again</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* EXPIRED / NO_SHOW STATE */}
      {isExpired && !isCancelled && (
        <div className="relative z-10 space-y-4 pt-1 animate-fadeUp">
          <div className="customer-glass-surface p-5 text-center space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-[var(--qf-warning)]/20 text-[var(--qf-warning)] border border-[var(--qf-warning)]/30">
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
            className="customer-primary-cta flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold text-xs transition-all active:scale-[0.99]"
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
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--qf-success)]/15 border border-[var(--qf-success)]/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[var(--qf-success)]">
              PAY AT COUNTER
            </span>
          </div>

          {/* Line items */}
          <div className="rounded-2xl border border-[var(--qf-border)] bg-white/5 p-3 divide-y divide-white/5 space-y-2">
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
              <span className="font-mono text-sm text-[var(--qf-primary)]">
                {formatPrice(activeOrder.total)}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            💵 <strong className="text-slate-200 uppercase tracking-wider">PAY AT COUNTER</strong> — Pay and collect your items when ready.
          </p>
        </div>
      ) : currentStage === 'WAITING' ? (
        /* Secondary Flow: Queue joined without ordering online yet */
        <div className="relative z-10 pt-3 border-t border-white/10 text-center space-y-2">
          {takeawayCustomerOrderingEnabled ? (
            <>
              <p className="text-xs text-slate-300">
                Want to choose your food while waiting?
              </p>
              <Link
                href={`/q/${restaurantSlug}/menu?qtoken=${token}&service=takeaway`}
                className="customer-glass-control flex min-h-[46px] h-11 w-full items-center justify-center gap-2 rounded-xl text-[var(--qf-primary)] font-bold text-xs transition-all active:scale-[0.99]"
              >
                <UtensilsCrossed className="h-3.5 w-3.5" />
                <span>Browse Menu &amp; Order Now</span>
              </Link>
              <p className="text-[10px] text-slate-400">
                You can also order directly with the staff at the counter when called.
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              Please wait until your ticket is called to place your order with the staff at the counter.
            </p>
          )}
        </div>
      ) : null}

      {/* 4. CANCELLATION (ONLY FOR WAITING / CALLED STAGE BEFORE PREPARATION) */}
      {(currentStage === 'WAITING' || (currentStage === 'CALLED' && !isPreparing && !isReady)) && (
        <div className="relative z-10 pt-2 border-t border-white/10 text-center">
          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            className="text-[11px] font-semibold text-rose-300/80 hover:text-rose-200 underline underline-offset-4 transition-colors cursor-pointer py-1"
          >
            Cancel Takeaway Ticket
          </button>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="customer-glass-card p-6 max-w-sm w-full space-y-4 shadow-2xl text-center animate-in zoom-in-95">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Cancel Takeaway Ticket?</h3>
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

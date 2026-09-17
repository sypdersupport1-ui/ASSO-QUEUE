'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Megaphone,
  CheckCircle2,
  Info,
  UtensilsCrossed,
  Volume2,
  Clock,
  Users,
  Check,
  X,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import type { PublicQueueStatusResponse } from '@/lib/services/queue-service';
import { CancelQueueDialog } from './CancelQueueDialog';
import { CustomerLateModal } from './CustomerLateModal';
import { CallDelaySheet } from './CallDelaySheet';
import { formatWaitLabel } from '@/lib/customer-join-ux';
import { chimeEngine } from '@/lib/audio-chime';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';
import {
  ticketStateMeta,
  formatTicketNumber,
  formatTableNumber,
  operatingNoteForTicket,
} from '@/lib/customer-ticket-ux';

interface QueueTicketCardProps {
  status: PublicQueueStatusResponse;
  token: string;
  restaurantSlug: string;
  restaurantName?: string;
  queueEnabled?: boolean;
  operatingState?: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
}

export function QueueTicketCard({
  status,
  token,
  restaurantSlug,
  restaurantName,
  queueEnabled = true,
  operatingState = 'OPEN',
}: QueueTicketCardProps) {
  const router = useRouter();
  const meta = ticketStateMeta(status.status);
  const ticketNo = formatTicketNumber(status.displayNumber, status.entryId);
  const waitLabel = meta.showWaitInfo ? formatWaitLabel(status.estimatedWaitMins) : null;
  const operatingNote = operatingNoteForTicket(status.status, queueEnabled, operatingState);
  const isCalled = status.status === 'CALLED';
  const isCompleted = !!status.completedAt;
  const isSeated = status.status === 'SEATED';
  const isTerminal =
    status.status === 'CANCELLED' ||
    status.status === 'NO_SHOW' ||
    status.status === 'EXPIRED' ||
    isCompleted;
  const tableDisplay = isSeated ? formatTableNumber(status.tableNumber) : null;

  // Track previous state for authoritative transitions & loud buzzers on every flow change
  const prevStatusRef = useRef(status.status);
  const prevPositionRef = useRef(status.position);
  const prevNowCallingRef = useRef(status.nowCallingNumber);
  const prevAlmostYourTurnRef = useRef(status.isAlmostYourTurn);

  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [buzzerTested, setBuzzerTested] = useState(false);

  // Customer Table-Call Decision State
  const [localResponse, setLocalResponse] = useState<'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED' | null>(
    status.callResponse || null
  );
  const [localDelayMins, setLocalDelayMins] = useState<number | null>(status.callDelayMinutes || null);
  const [isDelaySheetOpen, setIsDelaySheetOpen] = useState(false);
  const [isConfirmingDecline, setIsConfirmingDecline] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCallExpired, setIsCallExpired] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  // Sync prop changes to local response state
  useEffect(() => {
    if (status.callResponse) {
      setLocalResponse(status.callResponse);
    }
    if (status.callDelayMinutes) {
      setLocalDelayMins(status.callDelayMinutes);
    }
  }, [status.callResponse, status.callDelayMinutes]);

  // Server-authoritative countdown timer for CALLED state
  useEffect(() => {
    if (!isCalled || localResponse === 'DECLINED') {
      setCountdownSeconds(null);
      return;
    }

    const calledAtTime = status.calledAt ? new Date(status.calledAt).getTime() : Date.now();
    const timeoutMs = (status.callTimeoutMinutes ?? 15) * 60 * 1000;
    const expiresAt = calledAtTime + timeoutMs;

    const updateTimer = () => {
      const remainingSec = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setCountdownSeconds(remainingSec);
      if (remainingSec <= 0 && !localResponse) {
        setIsCallExpired(true);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isCalled, status.calledAt, status.callTimeoutMinutes, localResponse]);

  useEffect(() => {
    // 1. Authoritative status change
    if (prevStatusRef.current !== status.status) {
      if (status.status === 'CALLED') {
        chimeEngine.playBuzzerSound();
        setLiveAnnouncement('Your table is being called. Please return to the restaurant now.');
      } else if (status.status === 'NOTIFIED') {
        chimeEngine.playBuzzerSound();
        setLiveAnnouncement('Your table is being prepared. Please start heading to the restaurant.');
      } else if (status.status === 'SEATED') {
        chimeEngine.playSeatChime();
        setLiveAnnouncement(`You are seated. Enjoy your meal.${tableDisplay ? ` ${tableDisplay}.` : ''}`);
      } else {
        setLiveAnnouncement(`${meta.title}. ${meta.guidance}`);
      }
      prevStatusRef.current = status.status;
    } else {
      // 2. Flow changes within queue lifecycle (position advance, new ticket called, almost your turn)
      let flowChanged = false;

      // Position moved closer (e.g. 4 -> 3 or 2 -> 1)
      if (
        status.position !== null &&
        prevPositionRef.current !== null &&
        status.position < prevPositionRef.current
      ) {
        flowChanged = true;
      }

      // Now calling number updated by restaurant host
      if (
        status.nowCallingNumber &&
        prevNowCallingRef.current &&
        status.nowCallingNumber !== prevNowCallingRef.current
      ) {
        flowChanged = true;
      }

      // Proximity alert triggered
      if (status.isAlmostYourTurn && !prevAlmostYourTurnRef.current) {
        flowChanged = true;
      }

      if (flowChanged && !isTerminal && !isSeated) {
        chimeEngine.playBuzzerSound();
      }
    }

    prevPositionRef.current = status.position;
    prevNowCallingRef.current = status.nowCallingNumber;
    prevAlmostYourTurnRef.current = status.isAlmostYourTurn;
  }, [
    status.status,
    status.position,
    status.nowCallingNumber,
    status.isAlmostYourTurn,
    isTerminal,
    isSeated,
    meta.title,
    meta.guidance,
    tableDisplay,
  ]);

  const handleRespond = async (
    response: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED',
    delayMinutes?: number
  ) => {
    // 1. Instant optimistic feedback so user immediately sees their decision reflected
    setLocalResponse(response);
    if (delayMinutes) setLocalDelayMins(delayMinutes);
    if (response === 'DELAY_REQUESTED') setIsDelaySheetOpen(false);
    if (response === 'DECLINED') setIsConfirmingDecline(false);

    if (response === 'ACCEPTED') {
      chimeEngine.playCallChime();
      setLiveAnnouncement("You accepted your table call. You're on your way to the restaurant.");
    } else if (response === 'DELAY_REQUESTED') {
      chimeEngine.playAlertChime();
      setLiveAnnouncement(`Delay requested for ${delayMinutes || 10} minutes. Restaurant notified.`);
    } else if (response === 'DECLINED') {
      setLiveAnnouncement('You declined the table. Your queue spot has been cancelled.');
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/q/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          restaurantSlug,
          response,
          delayMinutes,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'CALL_EXPIRED') {
          setIsCallExpired(true);
          return;
        }
        console.error('Call response error:', data);
      }

      // Notify staff immediately via realtime narrow channel
      try {
        await broadcastCustomerQueueUpdate(status.entryId);
      } catch {}

      router.refresh();
    } catch (err) {
      console.error('Failed to submit call response:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      aria-label={`Queue ticket ${ticketNo}`}
      className="qf-card relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 p-5 sm:p-7 shadow-2xl text-center backdrop-blur-xl"
    >
      {/* Ambient background illumination */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-60 w-60 rounded-full bg-emerald-500/15 blur-3xl"
      />
      {isCalled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-sky-500/10 blur-2xl motion-safe:animate-pulse"
        />
      )}

      {/* Ticket cutout pass notches (tactile aesthetic) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-white/10 bg-[#0b0f1a] shadow-inner"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-white/10 bg-[#0b0f1a] shadow-inner"
      />

      {/* Screen-reader live announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* 1. HERO QUEUE PASS & GUEST IDENTITY */}
      <div className="relative z-10 space-y-2">
        {/* Sleek live badge */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-extrabold uppercase tracking-widest text-slate-300 shadow-sm backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span>Live Queue Pass</span>
          </span>
        </div>

        {/* Large high-impact ticket number */}
        <h1
          aria-label={`Your queue number is ${ticketNo}`}
          className="font-mono text-6xl sm:text-7xl font-black tracking-tight text-white tabular-nums drop-shadow-md my-1 motion-safe:animate-numberPop"
        >
          {ticketNo}
        </h1>

        {/* Guest & restaurant badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-xs">
          {restaurantName && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-slate-300 max-w-[220px] truncate">
              {restaurantName}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300">
            <Users className="h-3 w-3 text-emerald-400" />
            <span>
              {status.customerName || 'Guest'} · {status.partySize}{' '}
              {status.partySize === 1 ? 'guest' : 'guests'}
            </span>
          </span>
        </div>
      </div>

      {/* 2. STATE PRESENTATION */}

      {/* STATE A: WAITING / NOTIFIED */}
      {!isCalled && !isSeated && !isTerminal && (
        <div className="relative z-10 space-y-4 pt-4">
          {/* STANDOUT LIVE CALLING BOARD */}
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 sm:p-4 backdrop-blur-md shadow-xl">
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-200">
                <span className="relative flex h-2 w-2">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                Live Calling Board
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">
                ● Live Sync
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {/* NOW CALLING - Vivid Radiant Gold/Amber Card */}
              <div className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-amber-950/30 p-3 text-center shadow-lg shadow-amber-500/10">
                <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1">
                  <Megaphone className="h-3 w-3 text-amber-300 shrink-0" />
                  <span>Now Calling</span>
                </div>
                <p className="font-mono text-2xl sm:text-3xl font-black text-amber-200 tabular-nums drop-shadow-[0_2px_12px_rgba(245,158,11,0.4)]">
                  {status.nowCallingNumber ? (
                    `Q-${status.nowCallingNumber.replace(/^#+/, '')}`
                  ) : (
                    <span className="text-sm sm:text-base font-bold text-amber-300/80">Calling Soon</span>
                  )}
                </p>
                <span className="inline-block mt-1 text-[10px] font-bold text-amber-300/90">
                  {status.nowCallingNumber &&
                  status.nowCallingNumber.replace(/^#+/, '') === (status.displayNumber || '').replace(/^#+/, '')
                    ? '🎉 That’s You!'
                    : 'Host Stand'}
                </span>
              </div>

              {/* UP NEXT - Vivid Electric Cyan/Teal Card */}
              <div className="relative overflow-hidden rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/20 via-teal-500/10 to-blue-950/30 p-3 text-center shadow-lg shadow-cyan-500/10">
                <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider text-cyan-300 mb-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                  <span>Up Next</span>
                </div>
                <p className="font-mono text-2xl sm:text-3xl font-black text-cyan-200 tabular-nums drop-shadow-[0_2px_12px_rgba(6,182,212,0.4)]">
                  {status.position === 1 ? (
                    <span className="text-emerald-300 font-black">YOU! ✨</span>
                  ) : status.upNextNumber ? (
                    `Q-${status.upNextNumber.replace(/^#+/, '')}`
                  ) : (
                    <span className="text-sm sm:text-base font-bold text-cyan-300/80">On Deck</span>
                  )}
                </p>
                <span className="inline-block mt-1 text-[10px] font-bold text-cyan-300/90">
                  {status.position === 1 ? 'Ready to seat' : 'Next in line'}
                </span>
              </div>
            </div>
          </div>

          {/* VIBRANT QUEUE METRIC PODS */}
          <div className="grid grid-cols-2 gap-3">
            {/* Position / Turn Pod */}
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-teal-500/5 to-slate-900/60 p-3 text-center shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-0.5">
                {status.position === 1 ? 'Queue Status' : 'Parties Ahead'}
              </p>
              <p className="font-mono text-3xl sm:text-4xl font-black text-emerald-300 tabular-nums">
                {status.position === 1 ? (
                  <span className="text-emerald-300">Next</span>
                ) : status.peopleAhead !== null && status.peopleAhead >= 0 ? (
                  status.peopleAhead
                ) : (
                  '—'
                )}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                {status.position === 1 ? 'You are first in line' : 'Ahead of your party'}
              </p>
            </div>

            {/* Est. Wait Pod */}
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-slate-900/60 p-3 text-center shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-0.5 flex items-center justify-center gap-1">
                <Clock className="h-3 w-3 text-amber-400" />
                <span>Est. Wait</span>
              </p>
              <p className="font-mono text-3xl sm:text-4xl font-black text-amber-300 tabular-nums">
                {waitLabel ?? '—'}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">Live queue pace</p>
            </div>
          </div>

          {/* COLORFUL LINEAR STEPPER */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5 px-0.5">
              <span className="inline-flex items-center gap-1 font-extrabold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Waiting
              </span>
              <span className="text-slate-500">Called</span>
              <span className="text-slate-500">Seated</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full w-1/3 transition-all duration-500 shadow-sm shadow-emerald-500/50" />
            </div>
          </div>

          {/* Contextual Alert: Almost Your Turn */}
          {status.isAlmostYourTurn && (
            <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 to-orange-500/15 p-3.5 text-left flex items-start gap-3 shadow-lg shadow-amber-500/10 motion-safe:animate-fadeIn">
              <span className="text-xl shrink-0" aria-hidden="true">
                👣
              </span>
              <div>
                <p className="text-xs font-bold text-amber-200">Almost your turn</p>
                <p className="text-[11px] text-amber-300/90 leading-relaxed mt-0.5">
                  Please stay nearby so you don&apos;t miss your table.
                </p>
              </div>
            </div>
          )}

          {/* LOUD PAGER BUZZER TEST BUTTON */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                chimeEngine.playBuzzerSound();
                setBuzzerTested(true);
                setTimeout(() => setBuzzerTested(false), 2200);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer shadow-sm shadow-amber-500/5"
            >
              <Volume2 className="h-4 w-4 text-amber-400 shrink-0" />
              <span>{buzzerTested ? 'Buzzer ringing loud! 🔊' : 'Test Loud Pager Buzzer Sound'}</span>
            </button>
            <p className="text-[10px] text-slate-400 mt-1">
              Loud buzzer rings automatically on every queue update &amp; when called.
            </p>
          </div>

          {/* Running Late & Leave Queue Actions */}
          <div className="pt-3 border-t border-white/10 space-y-2.5">
            <CustomerLateModal
              token={token}
              restaurantSlug={restaurantSlug}
              customerName={status.customerName}
              lateInfo={status.lateInfo}
              initialMessages={status.chatMessages || []}
            />
            <CancelQueueDialog token={token} restaurantSlug={restaurantSlug} />
          </div>
        </div>
      )}

      {/* STATE B: CALLED — PROMINENT TABLE DECISION EXPERIENCE */}
      {isCalled && (
        <div className="relative z-10 space-y-5 pt-4 motion-safe:animate-fadeIn">
          {/* 1. EXPIRED STATE */}
          {isCallExpired ? (
            <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/20 via-slate-900/50 to-slate-950/80 p-5 text-center space-y-3 shadow-xl shadow-amber-500/10 motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-amber-300">
                <Clock className="h-4 w-4 text-amber-300" />
                CALL EXPIRED
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                Your table call window has passed
              </h2>
              <p className="text-xs text-amber-100/90 leading-relaxed max-w-[280px] mx-auto">
                Please speak with the restaurant host stand to check table availability or join the queue again.
              </p>
              <a
                href={`/q/${restaurantSlug}`}
                className="inline-flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-black shadow-lg shadow-amber-500/20 transition-all active:scale-[0.99]"
              >
                Join the queue again
              </a>
            </div>
          ) : localResponse === 'ACCEPTED' ? (
            /* 2. ACCEPTED / ON YOUR WAY STATE */
            <div className="rounded-2xl border border-emerald-500/50 bg-gradient-to-b from-emerald-500/20 via-emerald-600/10 to-slate-900/40 p-5 text-center space-y-3 shadow-xl shadow-emerald-500/10 motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-emerald-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                YOUR TURN IS HERE
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                Please return to the restaurant now.
              </h2>
              <div className="inline-block rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 py-1">
                <span className="text-xs font-black text-emerald-200">
                  ✓ Confirmed — You&apos;re on your way!
                </span>
              </div>
              <p className="text-xs text-emerald-100/90 leading-relaxed max-w-[280px] mx-auto">
                Host stand is expecting your party ({status.partySize}{' '}
                {status.partySize === 1 ? 'guest' : 'guests'}). Head to the entrance to be seated!
              </p>
              <div className="pt-2 flex items-center justify-center gap-4 text-xs font-semibold text-slate-400">
                <button
                  type="button"
                  onClick={() => setIsDelaySheetOpen(true)}
                  className="hover:text-amber-300 transition-colors cursor-pointer"
                >
                  Need more time? Delay →
                </button>
              </div>
            </div>
          ) : localResponse === 'DELAY_REQUESTED' ? (
            /* 3. DELAY REQUESTED STATE */
            <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/20 via-amber-600/10 to-slate-900/40 p-5 text-center space-y-3 shadow-xl shadow-amber-500/10 motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-amber-300">
                <Clock className="h-4 w-4 text-amber-300" />
                YOUR TURN IS HERE
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                Please return to the restaurant now.
              </h2>
              <div className="inline-block rounded-full border border-amber-400/40 bg-amber-500/20 px-4 py-1">
                <span className="text-xs font-black text-amber-200">
                  Delay Requested (+{localDelayMins || 10} min)
                </span>
              </div>
              <p className="text-xs text-amber-100/90 leading-relaxed max-w-[280px] mx-auto">
                The restaurant has been notified of your delay. When you arrive, tap below to confirm.
              </p>
              <button
                type="button"
                onClick={() => handleRespond('ACCEPTED')}
                disabled={isSubmitting}
                className="w-full min-h-[48px] h-12 flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                <span>I&apos;ve Arrived — Ready for Table</span>
              </button>
            </div>
          ) : localResponse === 'DECLINED' ? (
            /* 4. DECLINED / LEFT QUEUE STATE */
            <div className="rounded-2xl border border-rose-500/40 bg-gradient-to-b from-rose-500/20 via-slate-900/50 to-slate-950/80 p-6 text-center space-y-3.5 shadow-xl shadow-rose-500/10 motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-rose-300">
                <X className="h-4 w-4 text-rose-300" />
                QUEUE SPOT RELEASED
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                You have left the queue
              </h2>
              <p className="text-xs text-rose-100/90 leading-relaxed max-w-[280px] mx-auto">
                Your table was offered to the next waiting party. Thank you for notifying us!
              </p>
              <a
                href={`/q/${restaurantSlug}`}
                className="inline-flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black border border-white/10 transition-all active:scale-[0.99] cursor-pointer"
              >
                Join the queue again
              </a>
            </div>
          ) : (
            /* 5. AWAITING DECISION — HIGH-PRIORITY DECISION UI */
            <div className="rounded-2xl border border-sky-400/50 bg-gradient-to-b from-sky-500/20 via-sky-600/15 to-blue-900/30 p-5 text-center space-y-4 shadow-xl shadow-sky-500/20 motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-sky-300">
                <Megaphone className="h-4 w-4 text-sky-300" />
                YOUR TURN IS HERE
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  YOUR TABLE IS READY
                </h2>
                <p className="text-xs text-sky-100/90 leading-relaxed max-w-[280px] mx-auto mt-1">
                  Please return to the restaurant now.
                </p>
              </div>

              {/* Countdown timer */}
              {countdownSeconds !== null && (
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-amber-400/40 bg-amber-500/20 text-amber-200 text-xs font-mono font-bold">
                  <Clock className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
                  <span>
                    Please respond in{' '}
                    <strong className="text-amber-300 font-mono text-sm">
                      {Math.floor(countdownSeconds / 60)}:
                      {(countdownSeconds % 60).toString().padStart(2, '0')}
                    </strong>
                  </span>
                </div>
              )}

              {/* 3 Decision Actions: ACCEPT, DELAY, CAN'T COME */}
              <div className="space-y-2.5 pt-1">
                {/* Primary Action: ACCEPT */}
                <button
                  type="button"
                  onClick={() => handleRespond('ACCEPTED')}
                  disabled={isSubmitting}
                  className="w-full min-h-[50px] h-[50px] flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.99] cursor-pointer"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span>✓ ACCEPT — I&apos;m on my way</span>
                </button>

                {/* Secondary Actions: DELAY and CAN'T COME */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsDelaySheetOpen(true)}
                    disabled={isSubmitting}
                    className="min-h-[44px] py-2.5 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>⏱ DELAY</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDecline(true)}
                    disabled={isSubmitting}
                    className="min-h-[44px] py-2.5 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5 text-rose-400" />
                    <span>✕ CAN&apos;T COME</span>
                  </button>
                </div>
              </div>

              {/* Repeat loud buzzer button during called state */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    chimeEngine.playBuzzerSound();
                    setBuzzerTested(true);
                    setTimeout(() => setBuzzerTested(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5 text-sky-300" />
                  <span>{buzzerTested ? 'Buzzer ringing loud! 🔊' : 'Test Pager Buzzer Sound'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Progress: 2/3 filled */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5 px-0.5">
              <span className="text-emerald-400 font-extrabold">Waiting ✓</span>
              <span className="text-sky-300 font-extrabold">Called</span>
              <span className="text-slate-500">Seated</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div className="h-full bg-gradient-to-r from-emerald-500 via-sky-400 to-sky-300 rounded-full w-2/3 transition-all duration-500 shadow-md shadow-sky-500/40" />
            </div>
          </div>

          <div className="pt-2 border-t border-white/10">
            <CancelQueueDialog token={token} restaurantSlug={restaurantSlug} />
          </div>
        </div>
      )}

      {/* STATE C: SEATED */}
      {isSeated && (
        <div className="relative z-10 space-y-5 pt-4 motion-safe:animate-fadeIn">
          <div className="rounded-2xl border border-emerald-500/50 bg-gradient-to-b from-emerald-500/20 via-emerald-600/10 to-slate-900/40 p-5 text-center space-y-2.5 shadow-xl shadow-emerald-500/10">
            <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              {isCompleted ? 'Dining completed' : "You're seated"}
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white">
              {isCompleted ? 'Thank you for dining with us!' : 'Enjoy your meal!'}
            </h2>
            {tableDisplay && !isCompleted && (
              <div className="inline-block rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-1.5">
                <p className="font-mono text-base font-black text-emerald-200">
                  Seated at: {tableDisplay}
                </p>
              </div>
            )}
            <p className="text-xs text-emerald-100/80 leading-relaxed">
              {isCompleted
                ? 'We hope you enjoyed your visit. You have exited the queue.'
                : 'The wait is over — relaxed dining ahead.'}
            </p>
          </div>

          {/* Progress: 100% complete */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5 px-0.5">
              <span className="text-emerald-400 font-extrabold">Waiting ✓</span>
              <span className="text-emerald-400 font-extrabold">Called ✓</span>
              <span className="text-emerald-400 font-extrabold">Seated ✓</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full w-full transition-all duration-500 shadow-md shadow-emerald-500/40" />
            </div>
          </div>

          {/* Primary Action */}
          {isCompleted ? (
            <a
              href={`/q/${restaurantSlug}`}
              className="flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.99]"
            >
              Join the queue again
            </a>
          ) : (
            <Link
              href={`/q/${restaurantSlug}/menu?qtoken=${token}`}
              className="flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.99]"
            >
              <UtensilsCrossed className="h-4 w-4" />
              <span>View Menu &amp; Order</span>
            </Link>
          )}
        </div>
      )}

      {/* STATE D: TERMINAL (Left / Expired / No-Show) */}
      {isTerminal && !isSeated && !isCalled && (
        <div className="relative z-10 space-y-4 pt-4 motion-safe:animate-fadeIn">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-5 text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300">
              <Info className="h-4 w-4 text-slate-400" />
              {meta.title}
            </div>
            <p className="text-sm font-semibold text-white">{meta.subtitle}</p>
            <p className="text-xs text-slate-400">{meta.guidance}</p>
          </div>

          <a
            href={`/q/${restaurantSlug}`}
            className="flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.99]"
          >
            Join the queue again
          </a>
        </div>
      )}

      {/* Operating Note if any */}
      {operatingNote && (
        <p className="relative z-10 mt-4 text-center text-[11px] leading-relaxed text-slate-400">
          {operatingNote}
        </p>
      )}

      {/* Delay selection bottom sheet modal */}
      <CallDelaySheet
        isOpen={isDelaySheetOpen}
        onClose={() => setIsDelaySheetOpen(false)}
        onSubmit={(delayMinutes) => handleRespond('DELAY_REQUESTED', delayMinutes)}
        isSubmitting={isSubmitting}
      />

      {/* Lightweight Decline confirmation modal */}
      {isConfirmingDecline && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm motion-safe:animate-fadeIn"
        >
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 text-center space-y-4 shadow-2xl">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300 border border-rose-500/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">Leave the queue?</h3>
              <p className="text-xs text-slate-300 mt-1">
                You will lose your current place in line and your table will be offered to the next party.
              </p>
            </div>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleRespond('DECLINED')}
                disabled={isSubmitting}
                className="w-full min-h-[48px] h-12 flex items-center justify-center gap-2 rounded-2xl bg-rose-500 hover:bg-rose-400 text-white text-sm font-black shadow-lg shadow-rose-500/20 transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Leave Queue</span>
              </button>
              <button
                type="button"
                onClick={() => setIsConfirmingDecline(false)}
                disabled={isSubmitting}
                className="w-full min-h-[44px] py-2.5 text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Keep My Place
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

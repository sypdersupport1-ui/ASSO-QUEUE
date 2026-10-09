'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Megaphone,
  CheckCircle2,
  Info,
  UtensilsCrossed,
  Clock,
  Users,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Bell,
} from 'lucide-react';
import type { PublicQueueStatusResponse } from '@/lib/services/queue-service';
import { CancelQueueDialog } from './CancelQueueDialog';
import { CustomerLateModal } from './CustomerLateModal';
import { CallDelaySheet } from './CallDelaySheet';
import { formatWaitLabel } from '@/lib/customer-join-ux';
import { chimeEngine } from '@/lib/audio-chime';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';
import { syncTicketCookieAction } from '@/app/q/actions';
import {
  registerServiceWorker,
  triggerBackgroundTicketNotification,
  registerBackgroundPoll,
} from '@/lib/notifications/web-notification';
import { startBackgroundKeeper } from '@/lib/audio-background-keeper';
import {
  ticketStateMeta,
  formatTicketNumber,
  formatTableNumber,
  operatingNoteForTicket,
} from '@/lib/customer-ticket-ux';
import { calculateDelayCountdown } from '@/lib/delay-timer';

interface QueueTicketCardProps {
  status: PublicQueueStatusResponse;
  token: string;
  restaurantSlug: string;
  restaurantName?: string;
  queueEnabled?: boolean;
  operatingState?: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
}

export function QueueTicketCard({
  status: initialStatus,
  token,
  restaurantSlug,
  restaurantName,
  queueEnabled = true,
  operatingState = 'OPEN',
}: QueueTicketCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<PublicQueueStatusResponse>(initialStatus);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const meta = ticketStateMeta(status.status);
  const ticketNo = formatTicketNumber(status.displayNumber, status.entryId);
  const waitLabel = meta.showWaitInfo ? formatWaitLabel(status.estimatedWaitMins) : null;
  const operatingNote = operatingNoteForTicket(status.status, queueEnabled, operatingState);
  const isCalled = status.status === 'CALLED';
  const isNotified = status.status === 'NOTIFIED';
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
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // 1-second interval ticker for live timers
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    registerServiceWorker();
    startBackgroundKeeper();
    // Also register SW background polling so notifications work when page JS is throttled
    registerBackgroundPoll(token, restaurantSlug, status.status).catch(() => {});
  }, [token, restaurantSlug, status.status]);

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
        try {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([300, 150, 300, 150, 450]);
          }
        } catch {}
        triggerBackgroundTicketNotification(
          '⚡ YOUR TABLE IS READY!',
          `Party of ${status.partySize} — please return to the restaurant now!`,
          typeof window !== 'undefined' ? window.location.href : undefined
        );
        setLiveAnnouncement('Your table is being called. Please return to the restaurant now.');
      } else if (status.status === 'NOTIFIED') {
        chimeEngine.playBuzzerSound();
        try {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([250, 100, 250, 100, 350]);
          }
        } catch {}
        triggerBackgroundTicketNotification(
          "⚡ You're Getting Close! Table Preparing",
          'The restaurant host is preparing your table. Please start heading to the entrance now!',
          typeof window !== 'undefined' ? window.location.href : undefined
        );
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
    status.partySize,
  ]);

  // Active background & foreground real-time poller for instantaneous updates and lock-screen alerts
  useEffect(() => {
    if (isTerminal || !token) return;

    let isMounted = true;

    const checkLiveStatus = async () => {
      try {
        const queryParams = new URLSearchParams({ token });
        if (restaurantSlug) queryParams.set('restaurantSlug', restaurantSlug);

        const res = await fetch(`/api/q/status?${queryParams.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;

        const data = await res.json();
        const fresh = data?.status;
        if (!fresh || !isMounted) return;

        // Authoritatively update component state so UI instantly reflects live server truth
        setStatus(fresh);

        // Authoritative status transition detected in background or foreground
        if (fresh.status !== prevStatusRef.current) {
          const newStatus = fresh.status;
          prevStatusRef.current = newStatus;

          if (newStatus === 'NOTIFIED') {
            chimeEngine.playBuzzerSound();
            try {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate([300, 150, 300, 150, 450]);
              }
            } catch {}
            triggerBackgroundTicketNotification(
              "⚡ You're Getting Close! Table Preparing",
              `Party of ${fresh.partySize || status.partySize} — The host is preparing your table! Please head towards the restaurant.`,
              typeof window !== 'undefined' ? window.location.href : undefined
            );
            setLiveAnnouncement('Your table is being prepared. Please start heading to the restaurant.');
          } else if (newStatus === 'CALLED') {
            chimeEngine.playBuzzerSound();
            try {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate([400, 150, 400, 150, 600]);
              }
            } catch {}
            triggerBackgroundTicketNotification(
              '⚡ YOUR TABLE IS READY!',
              `Party of ${fresh.partySize || status.partySize} — Please return to the restaurant now!`,
              typeof window !== 'undefined' ? window.location.href : undefined
            );
            setLiveAnnouncement('Your table is being called. Please return to the restaurant now.');
          } else if (newStatus === 'SEATED') {
            chimeEngine.playSeatChime();
            setLiveAnnouncement('You are seated. Enjoy your meal.');
          } else if (newStatus === 'NO_SHOW') {
            chimeEngine.playAlertChime();
            triggerBackgroundTicketNotification(
              'Queue Status Update',
              'You have been marked as no-show by the restaurant.',
              typeof window !== 'undefined' ? window.location.href : undefined
            );
            setLiveAnnouncement('We missed you. You have been marked as no-show.');
          } else if (newStatus === 'CANCELLED') {
            chimeEngine.playAlertChime();
            triggerBackgroundTicketNotification(
              'Queue Ticket Cancelled',
              'Your queue ticket has been cancelled.',
              typeof window !== 'undefined' ? window.location.href : undefined
            );
            setLiveAnnouncement('Your queue ticket has been cancelled.');
          }

          router.refresh();
        } else if (
          (fresh.position !== null && fresh.position !== prevPositionRef.current) ||
          (fresh.nowCallingNumber && fresh.nowCallingNumber !== prevNowCallingRef.current) ||
          (fresh.isAlmostYourTurn !== prevAlmostYourTurnRef.current)
        ) {
          prevPositionRef.current = fresh.position;
          prevNowCallingRef.current = fresh.nowCallingNumber;
          prevAlmostYourTurnRef.current = fresh.isAlmostYourTurn;
          router.refresh();
        }
      } catch {}
    };

    const pollerId = setInterval(checkLiveStatus, 2000);

    const onWake = () => {
      checkLiveStatus();
      router.refresh();
    };

    const onLiveEvent = () => {
      checkLiveStatus();
    };

    window.addEventListener('focus', onWake);
    window.addEventListener('queue_update', onLiveEvent);
    window.addEventListener('queue_poll_tick', onLiveEvent);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onWake();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      isMounted = false;
      clearInterval(pollerId);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('queue_update', onLiveEvent);
      window.removeEventListener('queue_poll_tick', onLiveEvent);
    };
  }, [token, restaurantSlug, isTerminal, router, status.partySize]);

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
        // Fallback for resilient quit: if declining call errored, call cancel endpoint
        if (response === 'DECLINED') {
          try {
            await fetch('/api/q/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, restaurantSlug }),
            });
          } catch {}
        }
      }

      // If declined, automatically clear the ticket cookie so user completely exits the queue
      if (response === 'DECLINED') {
        try {
          await syncTicketCookieAction(restaurantSlug, token, true);
        } catch {}
      }

      // Notify staff immediately via realtime narrow channel
      try {
        await broadcastCustomerQueueUpdate(status.entryId);
      } catch {}

      router.refresh();
    } catch (err) {
      console.error('Failed to submit call response:', err);
      if (response === 'DECLINED') {
        try {
          await syncTicketCookieAction(restaurantSlug, token, true);
        } catch {}
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      aria-label={`Queue ticket ${ticketNo}`}
      onClick={() => startBackgroundKeeper()}
      onTouchStart={() => startBackgroundKeeper()}
      className="customer-glass-card relative overflow-hidden p-5 sm:p-7 text-center backdrop-blur-xl"
    >
      {/* Ambient background illumination */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-60 w-60 rounded-full blur-3xl opacity-30"
        style={{ background: 'var(--qf-primary-glow)' }}
      />
      {isNotified && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-3xl blur-3xl motion-safe:animate-pulse opacity-60"
          style={{ background: 'radial-gradient(circle at 50% 25%, rgba(245, 158, 11, 0.55), rgba(234, 88, 12, 0.35), transparent 75%)' }}
        />
      )}
      {isCalled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-3xl blur-3xl motion-safe:animate-pulse opacity-70"
          style={{ background: 'radial-gradient(circle at 50% 25%, rgba(244, 63, 94, 0.55), rgba(245, 158, 11, 0.35), transparent 75%)' }}
        />
      )}

      {/* Ticket cutout pass notches (tactile aesthetic) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-[var(--qf-border)] bg-[var(--qf-background)] shadow-inner"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-[var(--qf-border)] bg-[var(--qf-background)] shadow-inner"
      />

      {/* Screen-reader live announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* 1. HERO QUEUE PASS & GUEST IDENTITY */}
      <div className="relative z-10 space-y-2">
        {/* Sleek live badge */}
        <div>
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-md transition-all ${
              isNotified
                ? 'border-amber-400/40 bg-amber-500/15 text-amber-200 shadow-sm'
                : 'border-[var(--qf-border)] bg-white/5 text-slate-300'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isNotified ? 'bg-amber-400' : 'bg-[var(--qf-success)]'
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isNotified ? 'bg-amber-400' : 'bg-[var(--qf-success)]'
                }`}
              />
            </span>
            <span>{isNotified ? 'Host Notified · Table Preparing' : 'Live Digital Ticket'}</span>
          </span>
        </div>

        {/* Large high-impact ticket number */}
        <h1
          aria-label={`Your queue number is ${ticketNo}`}
          className="font-mono text-5xl sm:text-6xl font-black tracking-tight text-white tabular-nums drop-shadow-sm my-1 motion-safe:animate-numberPop"
        >
          {ticketNo}
        </h1>

        {/* Guest & restaurant badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-xs">
          {restaurantName && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/60 px-2.5 py-1 font-medium text-[var(--qf-text-secondary)] max-w-[220px] truncate">
              {restaurantName}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--qf-primary)]/30 bg-[var(--qf-primary-glow)] px-2.5 py-1 font-semibold text-[var(--qf-primary)]">
            <Users className="h-3.5 w-3.5 text-[var(--qf-primary)]" />
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
        <div className="relative z-10 space-y-4 pt-3">
          {/* REFINED NOTIFIED HERO ALERT */}
          {isNotified && (
            <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-500/15 via-amber-500/5 to-transparent p-4 sm:p-5 text-center shadow-lg motion-safe:animate-fadeIn space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/40 bg-amber-500/15 text-amber-200 text-[11px] font-bold uppercase tracking-widest">
                <Bell className="h-3.5 w-3.5 text-amber-300" />
                <span>Host Notified You · Table Preparing</span>
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Your Table is Being Prepared
              </h2>

              <p className="text-xs text-slate-300 font-medium leading-relaxed max-w-[340px] mx-auto">
                The restaurant host is preparing your table right now. Please start heading back to the entrance!
              </p>

              <div className="pt-1 flex items-center justify-center">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/20 px-3.5 py-1.5 text-xs font-bold text-amber-200">
                  <span>🚶‍♂️ Please head toward Host Stand</span>
                </div>
              </div>
            </div>
          )}

          {/* UNIFIED TELEMETRY & LIVE BOARD GRID */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left shadow-md">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                <span className="relative flex h-2 w-2">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--qf-warning)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--qf-warning)]" />
                </span>
                LIVE CALLING BOARD
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--qf-primary)]">
                ● Live Sync
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 divide-x divide-white/5">
              {/* Left Column: Live Calling */}
              <div className="space-y-3 pr-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Megaphone className="h-3 w-3 text-[var(--qf-warning)]" />
                    <span>Now Calling</span>
                  </span>
                  <p className="font-mono text-2xl sm:text-3xl font-black text-white tabular-nums mt-0.5">
                    {status.nowCallingNumber ? (
                      `Q-${status.nowCallingNumber.replace(/^#+/, '')}`
                    ) : (
                      <span className="text-sm sm:text-base font-semibold text-slate-400">Calling Soon</span>
                    )}
                  </p>
                  <span className="text-[10px] text-slate-400">
                    {status.nowCallingNumber &&
                    status.nowCallingNumber.replace(/^#+/, '') === (status.displayNumber || '').replace(/^#+/, '')
                      ? 'Your Turn!'
                      : 'Host Stand'}
                  </span>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--qf-primary)]" />
                    <span>Up Next</span>
                  </span>
                  <p className="font-mono text-lg sm:text-xl font-black text-[var(--qf-primary)] tabular-nums mt-0.5">
                    {status.position === 1 ? (
                      'YOU'
                    ) : status.upNextNumber ? (
                      `Q-${status.upNextNumber.replace(/^#+/, '')}`
                    ) : (
                      <span className="text-sm font-semibold text-slate-400">On Deck</span>
                    )}
                  </p>
                  <span className="text-[10px] text-slate-400">
                    {status.position === 1 ? 'Ready to seat' : 'Next in line'}
                  </span>
                </div>
              </div>

              {/* Right Column: Queue Metrics */}
              <div className="space-y-3 pl-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Queue Status
                  </span>
                  <p className="font-mono text-2xl sm:text-3xl font-black text-white tabular-nums mt-0.5">
                    {isNotified ? (
                      <span className="text-amber-300 text-xl sm:text-2xl font-black">NOTIFIED</span>
                    ) : status.position === 1 ? (
                      <span className="text-[var(--qf-primary)]">Next</span>
                    ) : status.peopleAhead !== null && status.peopleAhead >= 0 ? (
                      status.peopleAhead
                    ) : (
                      '—'
                    )}
                  </p>
                  <span className="text-[10px] text-slate-400">
                    {isNotified
                      ? 'Table being prepared'
                      : status.position === 1
                      ? 'You are first in line'
                      : 'Ahead of your party'}
                  </span>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-[var(--qf-accent-takeaway)]" />
                    <span>Est. Wait</span>
                  </span>
                  <p className="font-mono text-lg sm:text-xl font-black text-[var(--qf-accent-takeaway)] tabular-nums mt-0.5">
                    {waitLabel ?? '—'}
                  </p>
                  <span className="text-[10px] text-slate-400">Live queue pace</span>
                </div>
              </div>
            </div>
          </div>

          {/* LINEAR STEPPER */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px] font-semibold mb-1.5 px-0.5">
              <span
                className={`inline-flex items-center gap-1 font-bold ${
                  isNotified ? 'text-emerald-400' : 'text-[var(--qf-primary)]'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isNotified ? 'bg-emerald-400' : 'bg-[var(--qf-primary)]'
                  }`}
                />{' '}
                Waiting
              </span>
              <span
                className={`inline-flex items-center gap-1 font-bold ${
                  isNotified ? 'text-amber-300' : 'text-slate-500'
                }`}
              >
                {isNotified && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
                  </span>
                )}
                Notified
              </span>
              <span className="text-slate-500">Called</span>
              <span className="text-slate-500">Seated</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isNotified ? 'w-3/5 shadow-sm' : 'w-1/3'
                }`}
                style={{
                  background: isNotified
                    ? 'linear-gradient(to right, #10b981, #f59e0b)'
                    : 'linear-gradient(to right, var(--qf-primary), var(--qf-accent-dine-in))',
                }}
              />
            </div>
          </div>

          {/* RADAR ALERT: Almost Your Turn */}
          {!isNotified && status.isAlmostYourTurn && (
            <div className="relative overflow-hidden rounded-2xl border border-[var(--qf-warning)]/60 bg-gradient-to-r from-amber-950/50 via-slate-900 to-amber-950/40 p-3.5 text-left flex items-start gap-3 shadow-md motion-safe:animate-fadeIn">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--qf-warning)]/20 text-[var(--qf-warning)] border border-[var(--qf-warning)]/30 shadow-sm">
                <Clock className="h-4 w-4 animate-pulse text-[var(--qf-warning)]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--qf-warning)]">Almost Your Turn</p>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--qf-warning)] opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--qf-warning)]" />
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-medium leading-relaxed mt-0.5">
                  You are next on deck! Please stay close to the restaurant entrance so you don&apos;t miss your table call.
                </p>
              </div>
            </div>
          )}

          {/* Running Late & Leave Queue Actions */}
          <div className="pt-2 border-t border-white/10 space-y-2">
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
        <div className="relative z-10 space-y-4 pt-3 motion-safe:animate-fadeIn">
          {/* 1. EXPIRED STATE */}
          {isCallExpired ? (
            <div className="customer-glass-surface p-5 text-center space-y-3 shadow-md motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--qf-warning)]">
                <Clock className="h-4 w-4 text-[var(--qf-warning)]" />
                CALL EXPIRED
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                Your table call window has passed
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed max-w-[280px] mx-auto">
                Please speak with the restaurant host stand to check table availability or join the queue again.
              </p>
              <a
                href={`/q/${restaurantSlug}`}
                className="customer-primary-cta inline-flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl text-sm font-black transition-all active:scale-[0.99]"
              >
                Join the queue again
              </a>
            </div>
          ) : localResponse === 'ACCEPTED' ? (
            /* 2. ACCEPTED / ON YOUR WAY STATE */
            <div className="customer-glass-card p-5 text-center space-y-3 shadow-md motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--qf-success)]">
                <CheckCircle2 className="h-4 w-4 text-[var(--qf-success)]" />
                YOUR TURN IS HERE
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                Please return to the restaurant now.
              </h2>
              <div className="inline-block rounded-full border border-[var(--qf-border)] bg-white/5 px-4 py-1">
                <span className="text-xs font-bold text-[var(--qf-success)]">
                  ✓ Confirmed — You&apos;re on your way!
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed max-w-[280px] mx-auto">
                Host stand is expecting your party ({status.partySize}{' '}
                {status.partySize === 1 ? 'guest' : 'guests'}). Head to the entrance to be seated!
              </p>
              <div className="pt-1 flex items-center justify-center gap-4 text-xs font-semibold text-slate-400">
                <button
                  type="button"
                  onClick={() => setIsDelaySheetOpen(true)}
                  className="hover:text-[var(--qf-warning)] transition-colors cursor-pointer"
                >
                  Need more time? Delay →
                </button>
              </div>
            </div>
          ) : localResponse === 'DELAY_REQUESTED' ? (
            /* 3. DELAY REQUESTED STATE WITH LIVE COUNTDOWN TIMER */
            (() => {
              const delayStartIso = status.callRespondedAt || status.calledAt || status.lateInfo?.reportedAt;
              const delayMins = localDelayMins || status.callDelayMinutes || status.lateInfo?.delayMinutes || 10;
              const delayTimer = calculateDelayCountdown(delayStartIso, delayMins, nowMs);

              return (
                <div className="customer-glass-surface p-5 text-center space-y-3 shadow-md motion-safe:animate-fadeIn">
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--qf-warning)]">
                    <Clock className="h-4 w-4 text-[var(--qf-warning)]" />
                    YOUR TURN IS HERE
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-white">
                    Please return to the restaurant now.
                  </h2>

                  {/* Prominent Live Ticking Delay Timer Badge */}
                  <div className="rounded-2xl border border-[var(--qf-warning)]/40 bg-[var(--qf-warning)]/10 p-3.5 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2">
                      <span className="font-mono text-lg font-black tracking-wider text-[var(--qf-warning)]">
                        {delayTimer.isExpired ? '⏱️ 00:00 (Delay Expired)' : `⏱️ Delay Timer: ${delayTimer.formatted}`}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          delayTimer.isExpired ? 'bg-rose-500' : 'bg-[var(--qf-warning)]'
                        }`}
                        style={{ width: `${delayTimer.progressPercent}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-medium text-slate-300">
                      {delayTimer.isExpired
                        ? '⚠️ Requested delay time has passed. Please return to host stand immediately!'
                        : `Host notified of your delay (+${delayMins} min requested)`}
                    </p>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed max-w-[280px] mx-auto">
                    When you arrive at the host stand, tap below to confirm.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleRespond('ACCEPTED')}
                    disabled={isSubmitting}
                    className="customer-primary-cta w-full min-h-[48px] h-12 flex items-center justify-center gap-2 rounded-2xl text-sm font-black transition-all active:scale-[0.99] cursor-pointer"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    <span>I&apos;ve Arrived — Ready for Table</span>
                  </button>
                </div>
              );
            })()
          ) : localResponse === 'DECLINED' ? (
            /* 4. DECLINED / LEFT QUEUE STATE */
            <div className="customer-glass-surface p-6 text-center space-y-3.5 shadow-md motion-safe:animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--qf-danger)]">
                <X className="h-4 w-4 text-[var(--qf-danger)]" />
                Queue Spot Released
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                You have left the queue
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed max-w-[280px] mx-auto">
                Your table was offered to the next waiting party. Thank you for notifying us!
              </p>
              <a
                href={`/q/${restaurantSlug}`}
                className="customer-primary-cta flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl text-sm font-black transition-all active:scale-[0.99] cursor-pointer"
              >
                Join the queue again
              </a>
            </div>
          ) : (
            /* 5. AWAITING DECISION — CLEAN HIGH-PRIORITY DECISION CARD */
            <div className="relative overflow-hidden rounded-2xl border border-rose-500/60 bg-gradient-to-b from-rose-950/60 via-slate-900 to-amber-950/40 p-5 sm:p-6 text-center space-y-3.5 shadow-lg motion-safe:animate-fadeIn">
              {/* Clean pager beacon icon */}
              <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <Megaphone className="h-7 w-7 text-rose-300" />
              </div>

              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-rose-400/40 bg-rose-500/15 text-rose-300 text-[11px] font-bold uppercase tracking-widest mb-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-90" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
                  </span>
                  <span>Your Turn Is Here · Table Ready</span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  Your Table is Ready!
                </h2>
                <p className="text-xs sm:text-sm text-slate-200 font-medium leading-relaxed max-w-[320px] mx-auto mt-1">
                  Party of {status.partySize} — please proceed directly to the restaurant host stand now.
                </p>
              </div>

              {/* High-contrast countdown timer */}
              {countdownSeconds !== null && (
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-amber-400/50 bg-amber-500/15 text-amber-200 text-xs font-mono font-bold">
                  <Clock className="h-3.5 w-3.5 text-amber-300" />
                  <span>
                    Please respond in{' '}
                    <strong className="text-white font-mono text-sm font-black">
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
                  className="customer-primary-cta w-full min-h-[52px] h-[52px] flex items-center justify-center gap-2 rounded-2xl text-white text-sm sm:text-base font-black shadow-md transition-all cursor-pointer active:scale-[0.985]"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Check className="h-5 w-5 stroke-[2.5]" />
                  )}
                  <span>✓ ACCEPT — I&apos;m on my way</span>
                </button>

                {/* Secondary Actions: DELAY and CAN'T COME */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDelaySheetOpen(true)}
                    disabled={isSubmitting}
                    className="min-h-[44px] py-2 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>⏱ DELAY</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRespond('DECLINED')}
                    disabled={isSubmitting}
                    className="min-h-[44px] py-2 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-rose-400" />
                    )}
                    <span>✕ CAN&apos;T COME</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Progress: 2/3 filled */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold mb-1.5 px-0.5">
              <span className="text-[var(--qf-primary)] font-bold">Waiting ✓</span>
              <span className="text-[var(--qf-accent-dine-in)] font-bold">Called</span>
              <span className="text-slate-500">Seated</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full rounded-full w-2/3 transition-all duration-500 shadow-sm"
                style={{ background: 'linear-gradient(to right, var(--qf-primary), var(--qf-accent-dine-in))' }}
              />
            </div>
          </div>

          {/* Running Late & Host Chat Actions */}
          <div className="pt-2 border-t border-white/10 space-y-2">
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

      {/* STATE C: SEATED — CELEBRATORY DINING CARD */}
      {isSeated && (
        <div className="relative z-10 space-y-4 pt-3 motion-safe:animate-fadeIn">
          <div
            className="relative overflow-hidden rounded-2xl border border-[var(--qf-primary)]/40 p-5 sm:p-6 text-center space-y-3 shadow-lg"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--qf-primary) 12%, #080c14) 0%, #080c14 60%, color-mix(in srgb, var(--qf-accent-dine-in) 8%, #080c14) 100%)',
            }}
          >
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider"
              style={{
                borderColor: 'color-mix(in srgb, var(--qf-primary) 40%, transparent)',
                background: 'color-mix(in srgb, var(--qf-primary) 15%, transparent)',
                color: 'var(--qf-primary)',
              }}
            >
              <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--qf-primary)' }} />
              <span>{isCompleted ? 'Dining completed' : 'You Are Seated!'}</span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {isCompleted ? 'Thank you for dining with us!' : 'Welcome to Your Table!'}
            </h2>

            {tableDisplay && !isCompleted && (
              <div
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-1.5 shadow-sm"
                style={{
                  borderColor: 'color-mix(in srgb, var(--qf-primary) 50%, transparent)',
                  background: 'color-mix(in srgb, var(--qf-primary) 20%, transparent)',
                }}
              >
                <p className="font-mono text-base font-black text-white tracking-wide">
                  Table {tableDisplay}
                </p>
              </div>
            )}

            <p className="text-xs text-slate-300 font-medium leading-relaxed max-w-[320px] mx-auto">
              {isCompleted
                ? 'We hope you enjoyed your visit. You have exited the queue.'
                : 'Your wait is over — relax and enjoy your meal!'}
            </p>
          </div>

          {/* Progress: 100% complete */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold mb-1.5 px-0.5">
              <span className="text-[var(--qf-primary)] font-bold">Waiting ✓</span>
              <span className="text-[var(--qf-primary)] font-bold">Called ✓</span>
              <span className="text-[var(--qf-primary)] font-bold">Seated ✓</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full rounded-full w-full transition-all duration-500 shadow-sm"
                style={{ background: 'linear-gradient(to right, var(--qf-primary), var(--qf-accent-dine-in))' }}
              />
            </div>
          </div>

          {/* Primary Action */}
          {isCompleted ? (
            <a
              href={`/q/${restaurantSlug}`}
              className="customer-primary-cta flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl text-sm font-black transition-all active:scale-[0.99]"
            >
              Join the queue again
            </a>
          ) : (
            <Link
              href={`/q/${restaurantSlug}/menu?qtoken=${token}`}
              className="customer-primary-cta flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black transition-all active:scale-[0.99]"
            >
              <UtensilsCrossed className="h-4 w-4" />
              <span>View Menu &amp; Order</span>
            </Link>
          )}
        </div>
      )}

      {/* STATE D: TERMINAL (Left / Expired / No-Show) */}
      {isTerminal && !isSeated && !isCalled && (
        <div className="relative z-10 space-y-4 pt-3 motion-safe:animate-fadeIn">
          <div className="customer-glass-surface p-5 text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300">
              <Info className="h-4 w-4 text-slate-400" />
              {meta.title}
            </div>
            <p className="text-sm font-semibold text-white">{meta.subtitle}</p>
            <p className="text-xs text-slate-400">{meta.guidance}</p>
          </div>

          <a
            href={`/q/${restaurantSlug}`}
            className="customer-primary-cta flex min-h-[48px] h-12 w-full items-center justify-center rounded-2xl text-sm font-black transition-all active:scale-[0.99]"
          >
            Join the queue again
          </a>
        </div>
      )}

      {/* Operating Note if any */}
      {operatingNote && (
        <p className="relative z-10 mt-3 text-center text-[11px] leading-relaxed text-slate-400">
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
          <div className="customer-glass-card w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
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

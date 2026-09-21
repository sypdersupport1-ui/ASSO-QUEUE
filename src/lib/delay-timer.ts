/**
 * Delay Countdown Timer Utilities for Customer & Admin Queue Engine
 */

export interface DelayCountdownResult {
  remainingSec: number;
  totalSec: number;
  isExpired: boolean;
  formatted: string; // e.g. "04:35" or "00:00"
  statusLabel: string; // e.g. "04:35 left" or "EXPIRED"
  progressPercent: number; // 0 to 100 (percentage of delay remaining)
}

/**
 * Calculates remaining delay seconds and formatted MM:SS string based on start timestamp and delay duration in minutes.
 */
export function calculateDelayCountdown(
  startedAtIso?: string | null,
  delayMinutes: number = 10,
  currentMs: number = Date.now()
): DelayCountdownResult {
  const safeDelayMins = Math.max(1, Number(delayMinutes) || 10);
  const totalSec = safeDelayMins * 60;

  if (!startedAtIso) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return {
      remainingSec: totalSec,
      totalSec,
      isExpired: false,
      formatted,
      statusLabel: `${formatted} left`,
      progressPercent: 100,
    };
  }

  const startMs = new Date(startedAtIso).getTime();
  // Fallback if invalid date
  if (isNaN(startMs)) {
    const formatted = `${String(safeDelayMins).padStart(2, '0')}:00`;
    return {
      remainingSec: totalSec,
      totalSec,
      isExpired: false,
      formatted,
      statusLabel: `${formatted} left`,
      progressPercent: 100,
    };
  }

  const expireMs = startMs + totalSec * 1000;
  const remainingMs = expireMs - currentMs;

  if (remainingMs <= 0) {
    return {
      remainingSec: 0,
      totalSec,
      isExpired: true,
      formatted: '00:00',
      statusLabel: 'EXPIRED',
      progressPercent: 0,
    };
  }

  const remainingSec = Math.floor(remainingMs / 1000);
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const progressPercent = Math.min(100, Math.max(0, Math.round((remainingSec / totalSec) * 100)));

  return {
    remainingSec,
    totalSec,
    isExpired: false,
    formatted,
    statusLabel: `${formatted} left`,
    progressPercent,
  };
}

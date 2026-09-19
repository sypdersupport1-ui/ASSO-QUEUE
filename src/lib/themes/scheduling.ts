import { isRegisteredTheme, resolveCustomerTheme } from '@/lib/themes';
import type { CustomerTheme } from '@/lib/themes/types';
import { ValidationError } from '@/lib/errors';

export interface CustomerThemeSchedule {
  id: string;
  restaurant_id: string;
  theme_key: string;
  start_at: string; // ISO UTC string
  end_at: string;   // ISO UTC string
  timezone: string; // IANA timezone e.g. 'Asia/Kolkata'
  status: 'ACTIVE' | 'CANCELLED';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateThemeScheduleInput {
  themeKey: string;
  startAt: string | Date;
  endAt: string | Date;
  timezone?: string;
}

export interface UpdateThemeScheduleInput {
  themeKey?: string;
  startAt?: string | Date;
  endAt?: string | Date;
}

/**
 * Convert local date + time string in a specific IANA timezone into exact UTC Date.
 * DST-safe, pure Intl math. Customer browser locale never dictates scheduling.
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const trimmedDate = dateStr.trim();
  const trimmedTime = timeStr.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    throw new ValidationError(`Invalid date format "${dateStr}". Expected YYYY-MM-DD.`);
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmedTime)) {
    throw new ValidationError(`Invalid time format "${timeStr}". Expected HH:MM.`);
  }

  // Verify valid IANA timezone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new ValidationError(`Invalid IANA timezone "${timeZone}".`);
  }

  const dateParts = trimmedDate.split('-').map(Number);
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];

  if (year === undefined || month === undefined || day === undefined) {
    throw new ValidationError(`Invalid date format "${dateStr}".`);
  }

  const timeParts = trimmedTime.split(':').map(Number);
  const hour = timeParts[0] ?? 0;
  const minute = timeParts[1] ?? 0;
  const second = timeParts[2] ?? 0;

  // Initial UTC guess
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Formatter to inspect what guessUtc produces in target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(guessUtc);
  const getPart = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');

  const tzYear = getPart('year');
  const tzMonth = getPart('month');
  const tzDay = getPart('day');
  let tzHour = getPart('hour');
  if (tzHour === 24) tzHour = 0;
  const tzMinute = getPart('minute');
  const tzSecond = getPart('second');

  const tzTimeAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);
  const offsetMs = tzTimeAsUtc - guessUtc.getTime();

  // Exact UTC is guessUtc minus offset
  return new Date(guessUtc.getTime() - offsetMs);
}

/**
 * Convert UTC Date or ISO string into local components in restaurant timezone.
 */
export function utcToZonedDateTime(dateInput: Date | string, timeZone: string): {
  dateStr: string;
  timeStr: string;
  displayStr: string;
} {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError('Invalid date input for timezone conversion.');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  let hour = getPart('hour');
  if (hour === '24') hour = '00';
  const minute = getPart('minute');

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hour}:${minute}`;

  const displayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return {
    dateStr,
    timeStr,
    displayStr: displayFormatter.format(d),
  };
}

/**
 * Returns human-readable label for restaurant timezone (e.g. "IST (Asia/Kolkata)").
 */
export function getTimezoneLabel(timeZone: string): string {
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(d);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
    return `${tzName} (${timeZone})`;
  } catch {
    return timeZone;
  }
}

/**
 * Validate that end time is strictly after start time.
 */
export function validateScheduleInterval(startAt: Date, endAt: Date): void {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new ValidationError('Start and end times must be valid dates.');
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw new ValidationError('Schedule end time must be strictly after start time. Zero or negative duration schedules are rejected.');
  }
}

/**
 * Pure resolution logic: given baseline theme and schedules list, resolves the effective theme.
 *
 * Priority:
 * 1. Active schedule (status = ACTIVE && start_at <= now < end_at)
 * 2. Baseline customer_theme_key
 * 3. DEFAULT_CUSTOMER_THEME ('default')
 *
 * Also computes `nextTransitionSeconds` for bounded caching.
 */
export function resolveEffectiveThemeFromSchedules(
  baselineThemeKey: string | null | undefined,
  schedules: CustomerThemeSchedule[],
  now: Date = new Date()
): {
  theme: CustomerTheme;
  themeKey: string;
  activeSchedule: CustomerThemeSchedule | null;
  isScheduled: boolean;
  nextTransitionSeconds: number | null;
} {
  const nowMs = now.getTime();

  // 1. Find active schedule: start_at <= now < end_at
  const activeSchedule = schedules.find((s) => {
    if (s.status !== 'ACTIVE') return false;
    const startMs = new Date(s.start_at).getTime();
    const endMs = new Date(s.end_at).getTime();
    return startMs <= nowMs && nowMs < endMs;
  }) || null;

  let effectiveThemeKey: string;
  let isScheduled = false;

  if (activeSchedule && isRegisteredTheme(activeSchedule.theme_key)) {
    effectiveThemeKey = activeSchedule.theme_key;
    isScheduled = true;
  } else {
    effectiveThemeKey = baselineThemeKey || 'default';
    isScheduled = false;
  }

  const theme = resolveCustomerTheme(effectiveThemeKey);

  // 2. Compute next transition boundary (in seconds)
  const transitionDiffs: number[] = [];

  if (activeSchedule) {
    const activeEndDiff = new Date(activeSchedule.end_at).getTime() - nowMs;
    if (activeEndDiff > 0) {
      transitionDiffs.push(activeEndDiff);
    }
  }

  for (const s of schedules) {
    if (s.status !== 'ACTIVE') continue;
    const startDiff = new Date(s.start_at).getTime() - nowMs;
    if (startDiff > 0) {
      transitionDiffs.push(startDiff);
    }
  }

  let nextTransitionSeconds: number | null = null;
  if (transitionDiffs.length > 0) {
    const minMs = Math.min(...transitionDiffs);
    nextTransitionSeconds = Math.max(1, Math.ceil(minMs / 1000));
  }

  return {
    theme,
    themeKey: theme.key,
    activeSchedule,
    isScheduled,
    nextTransitionSeconds,
  };
}

import 'server-only';

import { createAdminClient } from '@/lib/db/supabase/admin';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { CacheService, CacheKeys } from '@/lib/cache';
import { z } from 'zod';

export interface QueueDaySchedule {
  day_of_week: number; // 0=Sunday .. 6=Saturday
  opens_at: string; // HH:MM
  closes_at: string; // HH:MM
  is_closed: boolean;
}

export const QueueDayScheduleSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  opens_at: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid opens_at HH:MM'),
  closes_at: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid closes_at HH:MM'),
  is_closed: z.boolean(),
}).refine((d) => d.is_closed || d.opens_at !== d.closes_at, {
  message: 'opens_at must differ from closes_at unless closed',
  path: ['closes_at'],
});

export const UpdateScheduleSchema = z.object({
  days: z.array(QueueDayScheduleSchema).length(7),
});

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hh = h || 0;
  const mm = m || 0;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/**
 * Get local DOW (0=Sun..6=Sat) and time minutes for a restaurant timezone at given instant.
 * Uses Intl (DST-safe), never server timezone.
 */
export function getLocalDayTime(timezone: string, at: Date = new Date()): { dow: number; minutes: number; timeStr: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const weekday = get('weekday');
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = dowMap[weekday] ?? at.getDay();
    const hour = parseInt(get('hour'), 10);
    const minute = parseInt(get('minute'), 10);
    const h = Number.isNaN(hour) ? 0 : hour % 24;
    const mi = Number.isNaN(minute) ? 0 : minute;
    return { dow, minutes: h * 60 + mi, timeStr: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` };
  } catch {
    return { dow: at.getDay(), minutes: at.getHours() * 60 + at.getMinutes(), timeStr: '00:00' };
  }
}

/**
 * Pure schedule-open check (shared by service + tests).
 * Cross-midnight: opens_at > closes_at means open from opens tonight + spill past midnight.
 */
export function isOpenBySchedule(days: QueueDaySchedule[], dow: number, minutes: number): boolean {
  const today = days.find((d) => d.day_of_week === dow);
  const yesterday = days.find((d) => d.day_of_week === (dow + 6) % 7);
  if (!today && !yesterday) return true; // no schedule = always open (legacy safe)
  if (today && !today.is_closed) {
    const o = timeToMinutes(today.opens_at);
    const c = timeToMinutes(today.closes_at);
    if (o < c) {
      if (minutes >= o && minutes < c) return true;
    } else if (o > c) {
      if (minutes >= o) return true; // tonight spill
    }
  }
  if (yesterday && !yesterday.is_closed) {
    const o = timeToMinutes(yesterday.opens_at);
    const c = timeToMinutes(yesterday.closes_at);
    if (o > c && minutes < c) return true; // spill from yesterday
  }
  return false;
}

export interface EffectiveAvailability {
  joinable: boolean;
  scheduledOpen: boolean;
  manualState: string;
  reason: 'OPEN' | 'PAUSED' | 'CLOSED' | 'OUTSIDE_HOURS' | 'FULL' | 'DISABLED';
  localDow: number;
  localTimeStr: string;
  nextOpening: { dayOffset: number; dayLabel: string; opensAt: string; opensAt12h: string } | null;
}

export class QueueScheduleService {
  static async getSchedule(restaurantId: string, actorUserId?: string): Promise<QueueDaySchedule[]> {
    if (actorUserId) {
      await AuthorizationService.requirePermission({ userId: actorUserId, restaurantId, permission: PERMISSIONS.QUEUE_VIEW });
    }
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('restaurant_queue_hours')
      .select('day_of_week, opens_at, closes_at, is_closed')
      .eq('restaurant_id', restaurantId)
      .order('day_of_week', { ascending: true });
    if (error) throw new Error(`Failed to load schedule: ${error.message}`);
    // Normalize TIME columns (may come back as HH:MM:SS) to HH:MM
    const norm = (t: string) => String(t).slice(0, 5);
    const rows = (data || []).map((r: { day_of_week: number; opens_at: string; closes_at: string; is_closed: boolean }) => ({
      day_of_week: r.day_of_week,
      opens_at: norm(r.opens_at),
      closes_at: norm(r.closes_at),
      is_closed: r.is_closed,
    }));
    // Fill missing days as open (safe default)
    const byDay = new Map(rows.map((r) => [r.day_of_week, r]));
    const full: QueueDaySchedule[] = [];
    for (let d = 0; d <= 6; d++) {
      full.push(byDay.get(d) || { day_of_week: d, opens_at: '00:00', closes_at: '23:59', is_closed: false });
    }
    return full;
  }

  static async updateSchedule(restaurantId: string, actorUserId: string, days: QueueDaySchedule[]): Promise<QueueDaySchedule[]> {
    const parsed = UpdateScheduleSchema.parse({ days });
    await AuthorizationService.requirePermission({ userId: actorUserId, restaurantId, permission: PERMISSIONS.RESTAURANT_UPDATE });
    const supabase = createAdminClient();
    // Transactional upsert of all 7 days
    const payload = parsed.days.map((d) => ({
      restaurant_id: restaurantId,
      day_of_week: d.day_of_week,
      opens_at: d.opens_at,
      closes_at: d.closes_at,
      is_closed: d.is_closed,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('restaurant_queue_hours').upsert(payload, { onConflict: 'restaurant_id,day_of_week' });
    if (error) throw new Error(`Failed to update schedule: ${error.message}`);
    await supabase.from('audit_logs').insert({
      restaurant_id: restaurantId,
      actor_user_id: actorUserId,
      action: 'queue_schedule_updated',
      entity_type: 'restaurant',
      entity_id: restaurantId,
      metadata: { days: parsed.days },
    });
    try {
      const { data: rest } = await supabase.from('restaurants').select('slug').eq('id', restaurantId).single();
      if (rest) await CacheService.invalidate(CacheKeys.publicRestaurant(rest.slug));
    } catch {}
    return QueueScheduleService.getSchedule(restaurantId);
  }

  static async evaluateAvailability(restaurantId: string, at: Date = new Date()): Promise<EffectiveAvailability> {
    const supabase = createAdminClient();
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('queue_enabled, queue_operating_state, status, timezone')
      .eq('id', restaurantId)
      .single();
    if (error || !restaurant) throw new Error('Restaurant not found');
    const tz = (restaurant as unknown as { timezone?: string }).timezone || 'Asia/Kolkata';
    const manualState = (restaurant as unknown as { queue_operating_state: string }).queue_operating_state || 'OPEN';
    const { dow, minutes, timeStr } = getLocalDayTime(tz, at);
    const schedule = await QueueScheduleService.getSchedule(restaurantId);
    const scheduledOpen = isOpenBySchedule(schedule, dow, minutes);
    const nextOpening = QueueScheduleService.getNextOpening(schedule, tz, at);

    // Precedence: lifecycle > queue_enabled > manual PAUSED/CLOSED > schedule > OPEN/CLOSING_SOON
    if ((restaurant as unknown as { status: string }).status !== 'ACTIVE' || !restaurant.queue_enabled) {
      return { joinable: false, scheduledOpen, manualState, reason: (restaurant as unknown as { status: string }).status !== 'ACTIVE' || !restaurant.queue_enabled ? 'CLOSED' : 'DISABLED', localDow: dow, localTimeStr: timeStr, nextOpening };
    }
    if (manualState === 'PAUSED') {
      return { joinable: false, scheduledOpen, manualState, reason: 'PAUSED', localDow: dow, localTimeStr: timeStr, nextOpening };
    }
    if (manualState === 'CLOSED') {
      return { joinable: false, scheduledOpen, manualState, reason: 'CLOSED', localDow: dow, localTimeStr: timeStr, nextOpening };
    }
    if (!scheduledOpen) {
      return { joinable: false, scheduledOpen, manualState, reason: 'OUTSIDE_HOURS', localDow: dow, localTimeStr: timeStr, nextOpening };
    }
    return { joinable: true, scheduledOpen, manualState, reason: 'OPEN', localDow: dow, localTimeStr: timeStr, nextOpening };
  }

  /**
   * Deterministic next opening within 7 days (read-only). Returns null if none.
   */
  static getNextOpening(
    schedule: QueueDaySchedule[],
    timezone: string,
    at: Date = new Date()
  ): { dayOffset: number; dayLabel: string; opensAt: string; opensAt12h: string } | null {
    const { dow, minutes } = getLocalDayTime(timezone, at);
    for (let offset = 0; offset < 7; offset++) {
      const d = (dow + offset) % 7;
      const row = schedule.find((r) => r.day_of_week === d);
      if (!row || row.is_closed) continue;
      const o = timeToMinutes(row.opens_at);
      const c = timeToMinutes(row.closes_at);
      if (offset === 0) {
        if (o < c) {
          if (minutes < o) {
            return { dayOffset: 0, dayLabel: 'Today', opensAt: row.opens_at, opensAt12h: formatTime12h(row.opens_at) };
          }
          if (minutes >= o && minutes < c) {
            return { dayOffset: 0, dayLabel: 'Today', opensAt: row.opens_at, opensAt12h: formatTime12h(row.opens_at) };
          }
          continue; // passed today's window
        } else {
          // cross-midnight opens tonight
          if (minutes < o) {
            return { dayOffset: 0, dayLabel: 'Today', opensAt: row.opens_at, opensAt12h: formatTime12h(row.opens_at) };
          }
          return { dayOffset: 0, dayLabel: 'Today', opensAt: row.opens_at, opensAt12h: formatTime12h(row.opens_at) };
        }
      } else {
        return { dayOffset: offset, dayLabel: DAY_LABELS[d] || `Day ${d}`, opensAt: row.opens_at, opensAt12h: formatTime12h(row.opens_at) };
      }
    }
    return null;
  }
}

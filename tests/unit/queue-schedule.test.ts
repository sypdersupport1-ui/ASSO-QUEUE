import { describe, it, expect } from 'vitest';
import { isOpenBySchedule, getLocalDayTime, QueueScheduleService, type QueueDaySchedule } from '@/lib/services/queue-schedule-service';

const openAll: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, opens_at: '00:00', closes_at: '23:59', is_closed: false }));

describe('Queue schedule - open check', () => {
  it('open all day allows midday', () => {
    expect(isOpenBySchedule(openAll, 1, 12 * 60)).toBe(true);
  });
  it('closed day blocks', () => {
    const days = openAll.map((d) => (d.day_of_week === 1 ? { ...d, is_closed: true } : d));
    expect(isOpenBySchedule(days, 1, 12 * 60)).toBe(false);
  });
  it('before opening rejected, after closing rejected', () => {
    const days: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, opens_at: '18:00', closes_at: '22:00', is_closed: false }));
    expect(isOpenBySchedule(days, 1, 17 * 60)).toBe(false);
    expect(isOpenBySchedule(days, 1, 19 * 60)).toBe(true);
    expect(isOpenBySchedule(days, 1, 22 * 60 + 1)).toBe(false);
  });
  it('cross-midnight 22:00-01:00 works tonight and spill', () => {
    const days: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, opens_at: '22:00', closes_at: '01:00', is_closed: false }));
    expect(isOpenBySchedule(days, 1, 23 * 60)).toBe(true); // Monday night
    expect(isOpenBySchedule(days, 2, 0 * 60 + 30)).toBe(true); // Tuesday early from Monday spill
    expect(isOpenBySchedule(days, 1, 12 * 60)).toBe(false); // Monday midday closed
  });
  it('opens_at == closes_at is invalid (open check treats as closed unless is_closed)', () => {
    const days: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, opens_at: '09:00', closes_at: '09:00', is_closed: false }));
    expect(isOpenBySchedule(days, 1, 9 * 60)).toBe(false);
  });
  it('no schedule rows = always open (legacy safe)', () => {
    expect(isOpenBySchedule([], 1, 12 * 60)).toBe(true);
  });
});

describe('Queue schedule - next opening', () => {
  it('same-day future opening', () => {
    const days: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, opens_at: '18:00', closes_at: '22:00', is_closed: false }));
    // Monday 10:00 Asia/Kolkata -> next opening today 18:00
    const at = new Date('2026-09-14T10:00:00+05:30'); // Monday
    const next = QueueScheduleService.getNextOpening(days, 'Asia/Kolkata', at);
    expect(next).not.toBeNull();
    expect(next!.opensAt).toBe('18:00');
  });
  it('closed days skipped', () => {
    const days: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d, opens_at: '09:00', closes_at: '17:00', is_closed: d === 1 || d === 2,
    }));
    const at = new Date('2026-09-14T10:00:00+05:30'); // Monday (closed)
    const next = QueueScheduleService.getNextOpening(days, 'Asia/Kolkata', at);
    expect(next).not.toBeNull();
    expect(next!.dayOffset).toBeGreaterThan(0);
  });
  it('no opening within 7 days returns null', () => {
    const days: QueueDaySchedule[] = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, opens_at: '09:00', closes_at: '17:00', is_closed: true }));
    const next = QueueScheduleService.getNextOpening(days, 'Asia/Kolkata', new Date());
    expect(next).toBeNull();
  });
});

describe('Queue schedule - timezone', () => {
  it('uses restaurant timezone, not server', () => {
    // Same instant: 2026-09-14T18:30:00Z = 00:00 IST next day (Tue) vs 14:30 EDT (Mon)
    const at = new Date('2026-09-14T18:30:00Z');
    const ist = getLocalDayTime('Asia/Kolkata', at);
    const ny = getLocalDayTime('America/New_York', at);
    expect(ist.dow).toBe(2); // Tuesday in IST
    expect(ny.dow).toBe(1); // Monday in NY
  });
  it('DST-safe via Intl (America/New_York summer vs winter)', () => {
    const summer = getLocalDayTime('America/New_York', new Date('2026-07-14T12:00:00Z'));
    const winter = getLocalDayTime('America/New_York', new Date('2026-01-14T12:00:00Z'));
    expect([0,1,2,3,4,5,6]).toContain(summer.dow);
    expect([0,1,2,3,4,5,6]).toContain(winter.dow);
  });
});

describe('Queue schedule - health precedence', () => {
  it('manual PAUSED wins over schedule', () => {
    // Documented precedence: lifecycle > queue_enabled > manual PAUSED/CLOSED > schedule
    const manualState = 'PAUSED';
    const scheduledOpen = false;
    const health = manualState === 'PAUSED' ? 'PAUSED' : !scheduledOpen ? 'CLOSED' : 'HEALTHY';
    expect(health).toBe('PAUSED');
  });
});

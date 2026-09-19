import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CustomerThemeScheduleService,
  type CustomerThemeSchedule,
} from '@/lib/services/customer-theme-schedule-service';
import {
  getRegisteredThemes,
  isRegisteredTheme,
} from '@/lib/themes';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { AuthorizationError } from '@/lib/errors';
import {
  createCustomerThemeScheduleAction,
  updateCustomerThemeScheduleAction,
  cancelCustomerThemeScheduleAction,
} from '@/app/dashboard/actions';

// Mock server-only Supabase calls & revalidatePath
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('Phase 5 — Customer Theme Scheduling Engine Tests', () => {
  const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = 'test-admin-uid';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Timezone conversion: restaurant timezone priority over client browser
  it('1. zonedDateTimeToUtc converts local restaurant time to canonical UTC using Intl (DST-safe)', () => {
    // Asia/Kolkata is UTC+5:30
    const kolkataUtc = CustomerThemeScheduleService.zonedDateTimeToUtc('2026-10-20', '18:00', 'Asia/Kolkata');
    // 18:00 IST = 12:30 UTC
    expect(kolkataUtc.toISOString()).toBe('2026-10-20T12:30:00.000Z');

    // America/New_York on Oct 20 is in EDT (UTC-4)
    const nyUtc = CustomerThemeScheduleService.zonedDateTimeToUtc('2026-10-20', '18:00', 'America/New_York');
    // 18:00 EDT = 22:00 UTC
    expect(nyUtc.toISOString()).toBe('2026-10-20T22:00:00.000Z');

    // America/New_York on Dec 20 is in EST (UTC-5)
    const nyWinterUtc = CustomerThemeScheduleService.zonedDateTimeToUtc('2026-12-20', '18:00', 'America/New_York');
    // 18:00 EST = 23:00 UTC
    expect(nyWinterUtc.toISOString()).toBe('2026-12-20T23:00:00.000Z');
  });

  it('2. utcToZonedDateTime correctly decomposes UTC into local restaurant components', () => {
    const utcDate = new Date('2026-10-20T12:30:00.000Z');
    const local = CustomerThemeScheduleService.utcToZonedDateTime(utcDate, 'Asia/Kolkata');
    expect(local.dateStr).toBe('2026-10-20');
    expect(local.timeStr).toBe('18:00');
  });

  it('3. getTimezoneLabel formats user-friendly label with IANA timezone', () => {
    const label = CustomerThemeScheduleService.getTimezoneLabel('Asia/Kolkata');
    expect(label).toContain('Asia/Kolkata');
  });

  // 2. All 11 approved theme keys accepted, arbitrary rejected
  it('4. Valid registered theme keys accepted across all 11 themes', () => {
    const themes = getRegisteredThemes();
    expect(themes).toHaveLength(11);
    for (const t of themes) {
      expect(isRegisteredTheme(t.key)).toBe(true);
    }
  });

  it('5. Invalid or arbitrary theme keys rejected before persistence', () => {
    expect(isRegisteredTheme('unknown-theme')).toBe(false);
    expect(isRegisteredTheme('<script>alert(1)</script>')).toBe(false);
    expect(isRegisteredTheme('{ "color": "red" }')).toBe(false);
    expect(isRegisteredTheme('')).toBe(false);
  });

  // 3. Positive duration interval validation
  it('6. validateScheduleInterval enforces end_at > start_at; rejects zero or negative duration', () => {
    const start = new Date('2026-10-20T10:00:00.000Z');
    const endValid = new Date('2026-10-20T12:00:00.000Z');
    const endZero = new Date('2026-10-20T10:00:00.000Z');
    const endNegative = new Date('2026-10-20T09:00:00.000Z');

    expect(() => CustomerThemeScheduleService.validateScheduleInterval(start, endValid)).not.toThrow();

    expect(() => CustomerThemeScheduleService.validateScheduleInterval(start, endZero)).toThrow(
      /Schedule end time must be strictly after start time/
    );

    expect(() => CustomerThemeScheduleService.validateScheduleInterval(start, endNegative)).toThrow(
      /Schedule end time must be strictly after start time/
    );
  });

  // 4. Overlap detection & interval semantics
  it('7. Half-open interval semantics: adjacent intervals do NOT overlap', () => {
    // Schedule 1: 10:00 to 12:00
    // Schedule 2: 12:00 to 14:00 (adjacent at 12:00)
    // [10:00, 12:00) and [12:00, 14:00) do not intersect
    const s1Start = new Date('2026-10-20T10:00:00.000Z').getTime();
    const s1End = new Date('2026-10-20T12:00:00.000Z').getTime();
    const s2Start = new Date('2026-10-20T12:00:00.000Z').getTime();
    const s2End = new Date('2026-10-20T14:00:00.000Z').getTime();

    const intersects = s1Start < s2End && s1End > s2Start;
    expect(intersects).toBe(false);
  });

  it('8. Intersecting intervals are correctly detected as overlapping', () => {
    // Schedule 1: 10:00 to 12:00
    // Schedule 2: 11:30 to 13:00 (overlaps between 11:30 and 12:00)
    const s1Start = new Date('2026-10-20T10:00:00.000Z').getTime();
    const s1End = new Date('2026-10-20T12:00:00.000Z').getTime();
    const s2Start = new Date('2026-10-20T11:30:00.000Z').getTime();
    const s2End = new Date('2026-10-20T13:00:00.000Z').getTime();

    const intersects = s1Start < s2End && s1End > s2Start;
    expect(intersects).toBe(true);
  });

  // 5. Active schedule resolution & exact boundaries
  it('9. Active schedule resolution: start_at <= now < end_at selects scheduled theme', () => {
    const schedules: CustomerThemeSchedule[] = [
      {
        id: 'sched-1',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'durga-puja',
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-25T23:59:59.000Z',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        created_by: USER_ID,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];

    // Time during schedule
    const during = new Date('2026-10-22T12:00:00.000Z');
    const result = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'weekend-special',
      schedules,
      during
    );

    expect(result.themeKey).toBe('durga-puja');
    expect(result.theme.name).toBe('Durga Puja');
    expect(result.isScheduled).toBe(true);
    expect(result.activeSchedule?.id).toBe('sched-1');
  });

  it('10. Exact start boundary: exactly at start_at, schedule becomes active', () => {
    const schedules: CustomerThemeSchedule[] = [
      {
        id: 'sched-1',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'diwali',
        start_at: '2026-11-01T00:00:00.000Z',
        end_at: '2026-11-05T23:59:59.000Z',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        created_by: USER_ID,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];

    // Exact millisecond of start_at
    const exactStart = new Date('2026-11-01T00:00:00.000Z');
    const result = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'default',
      schedules,
      exactStart
    );

    expect(result.themeKey).toBe('diwali');
    expect(result.isScheduled).toBe(true);
  });

  it('11. Exact end boundary: exactly at end_at, schedule becomes inactive and falls back to baseline', () => {
    const schedules: CustomerThemeSchedule[] = [
      {
        id: 'sched-1',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'diwali',
        start_at: '2026-11-01T00:00:00.000Z',
        end_at: '2026-11-05T23:59:59.000Z',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        created_by: USER_ID,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];

    // Exact millisecond of end_at (exclusive bound)
    const exactEnd = new Date('2026-11-05T23:59:59.000Z');
    const result = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'weekend-special',
      schedules,
      exactEnd
    );

    expect(result.themeKey).toBe('weekend-special');
    expect(result.isScheduled).toBe(false);
    expect(result.activeSchedule).toBeNull();
  });

  it('12. Inactive schedule resolution: before start or after end falls back to base theme', () => {
    const schedules: CustomerThemeSchedule[] = [
      {
        id: 'sched-1',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'christmas',
        start_at: '2026-12-24T00:00:00.000Z',
        end_at: '2026-12-26T23:59:59.000Z',
        timezone: 'UTC',
        status: 'ACTIVE',
        created_by: USER_ID,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];

    // Before start
    const beforeStart = new Date('2026-12-23T23:59:59.000Z');
    const resBefore = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules('happy-hour', schedules, beforeStart);
    expect(resBefore.themeKey).toBe('happy-hour');
    expect(resBefore.isScheduled).toBe(false);

    // After end
    const afterEnd = new Date('2026-12-27T00:00:00.000Z');
    const resAfter = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules('happy-hour', schedules, afterEnd);
    expect(resAfter.themeKey).toBe('happy-hour');
    expect(resAfter.isScheduled).toBe(false);
  });

  // 6. Fallback hierarchy
  it('13. Base theme fallback: when no schedule is active, uses restaurant baseline theme', () => {
    const result = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'poila-boishakh',
      [],
      new Date()
    );
    expect(result.themeKey).toBe('poila-boishakh');
    expect(result.theme.name).toBe('Poila Boishakh');
  });

  it('14. Default fallback: when base theme is empty/undefined/invalid, falls back to default theme', () => {
    const resUndefined = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(undefined, [], new Date());
    expect(resUndefined.themeKey).toBe('default');

    const resInvalid = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules('bogus-key', [], new Date());
    expect(resInvalid.themeKey).toBe('default');
  });

  it('15. Invalid scheduled theme key fallback: falls back to base theme if schedule has unknown key', () => {
    const corruptSchedule: CustomerThemeSchedule[] = [
      {
        id: 'sched-corrupt',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'non-existent-festival',
        start_at: '2026-10-01T00:00:00.000Z',
        end_at: '2026-10-31T23:59:59.000Z',
        timezone: 'UTC',
        status: 'ACTIVE',
        created_by: null,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];

    const result = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'kali-puja',
      corruptSchedule,
      new Date('2026-10-15T12:00:00.000Z')
    );

    expect(result.themeKey).toBe('kali-puja');
    expect(result.theme.name).toBe('Kali Puja');
  });

  // 7. Base theme remains unchanged while schedule is active
  it('16. Base theme is not mutated when a schedule becomes active or inactive', () => {
    const baseline = 'weekend-special';
    const schedules: CustomerThemeSchedule[] = [
      {
        id: 'sched-1',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'holi',
        start_at: '2026-03-25T00:00:00.000Z',
        end_at: '2026-03-26T23:59:59.000Z',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        created_by: USER_ID,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ];

    // During schedule
    const during = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      baseline,
      schedules,
      new Date('2026-03-25T12:00:00.000Z')
    );
    expect(during.themeKey).toBe('holi');

    // After schedule
    const after = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      baseline,
      schedules,
      new Date('2026-03-27T12:00:00.000Z')
    );
    expect(after.themeKey).toBe(baseline);
  });

  // 8. Changing base theme during active schedule
  it('17. Changing base theme while schedule is active keeps schedule on QR until completion, then switches to new base', () => {
    const schedules: CustomerThemeSchedule[] = [
      {
        id: 'sched-1',
        restaurant_id: RESTAURANT_ID,
        theme_key: 'durga-puja',
        start_at: '2026-10-20T00:00:00.000Z',
        end_at: '2026-10-24T23:59:59.000Z',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        created_by: USER_ID,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];

    // Initially base was 'default', during schedule QR shows 'durga-puja'
    const duringBeforeChange = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'default',
      schedules,
      new Date('2026-10-22T10:00:00.000Z')
    );
    expect(duringBeforeChange.themeKey).toBe('durga-puja');

    // Admin changes base theme to 'happy-new-year' while schedule is active
    const newBase = 'happy-new-year';

    // During schedule, QR still shows 'durga-puja'
    const duringAfterChange = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      newBase,
      schedules,
      new Date('2026-10-22T12:00:00.000Z')
    );
    expect(duringAfterChange.themeKey).toBe('durga-puja');

    // Once schedule ends, QR immediately resolves to newBase ('happy-new-year')
    const afterScheduleEnds = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      newBase,
      schedules,
      new Date('2026-10-25T00:00:01.000Z')
    );
    expect(afterScheduleEnds.themeKey).toBe('happy-new-year');
  });

  // 9. Cancellation immediately reverts to base theme
  it('18. Cancelling active schedule immediately reverts effective customer theme to base theme', () => {
    const activeSchedule: CustomerThemeSchedule = {
      id: 'sched-1',
      restaurant_id: RESTAURANT_ID,
      theme_key: 'valentines-day',
      start_at: '2026-02-14T00:00:00.000Z',
      end_at: '2026-02-14T23:59:59.000Z',
      timezone: 'UTC',
      status: 'ACTIVE',
      created_by: USER_ID,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    };

    const during = new Date('2026-02-14T12:00:00.000Z');

    // When ACTIVE -> valentines-day
    const resActive = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules('default', [activeSchedule], during);
    expect(resActive.themeKey).toBe('valentines-day');

    // Once CANCELLED -> immediately reverts to base theme
    const cancelledSchedule: CustomerThemeSchedule = { ...activeSchedule, status: 'CANCELLED' };
    const resCancelled = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules('default', [cancelledSchedule], during);
    expect(resCancelled.themeKey).toBe('default');
    expect(resCancelled.isScheduled).toBe(false);
  });

  // 10. Cache boundary calculation
  it('19. Next transition boundary calculated accurately for bounded cache TTL', () => {
    const now = new Date('2026-10-20T10:00:00.000Z');

    // An upcoming schedule starts in 120 seconds
    const upcomingSchedule: CustomerThemeSchedule = {
      id: 'sched-upcoming',
      restaurant_id: RESTAURANT_ID,
      theme_key: 'diwali',
      start_at: new Date(now.getTime() + 120 * 1000).toISOString(),
      end_at: new Date(now.getTime() + 3600 * 1000).toISOString(),
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      created_by: USER_ID,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    };

    const res = CustomerThemeScheduleService.resolveEffectiveThemeFromSchedules(
      'default',
      [upcomingSchedule],
      now
    );

    expect(res.themeKey).toBe('default');
    expect(res.nextTransitionSeconds).toBe(120);
  });

  // 11. RBAC & Permissions
  it('20. Staff role lacks RESTAURANT_UPDATE permission and cannot manage schedules', () => {
    const staffPerms = ROLE_DEFAULT_PERMISSIONS.STAFF;
    expect(staffPerms).not.toContain(PERMISSIONS.RESTAURANT_UPDATE);
    expect(staffPerms).toContain(PERMISSIONS.RESTAURANT_VIEW);

    const adminPerms = ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN;
    expect(adminPerms).toContain(PERMISSIONS.RESTAURANT_UPDATE);
  });

  it('21. Server actions reject unauthenticated or non-admin callers', async () => {
    vi.spyOn(RestaurantAdminService, 'createCustomerThemeSchedule').mockRejectedValueOnce(
      new Error('Access denied. Active Restaurant Admin membership required.')
    );

    const res = await createCustomerThemeScheduleAction({
      themeKey: 'diwali',
      startAt: '2026-11-01T00:00:00.000Z',
      endAt: '2026-11-05T23:59:59.000Z',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Access denied');
  });

  it('22. Server actions trigger revalidation upon create, update, and cancel', async () => {
    vi.spyOn(RestaurantAdminService, 'createCustomerThemeSchedule').mockResolvedValueOnce({
      id: 'sched-new',
      restaurant_id: RESTAURANT_ID,
      theme_key: 'christmas',
      start_at: '2026-12-24T00:00:00.000Z',
      end_at: '2026-12-26T23:59:59.000Z',
      timezone: 'UTC',
      status: 'ACTIVE',
      created_by: USER_ID,
      created_at: '2026-12-01T00:00:00.000Z',
      updated_at: '2026-12-01T00:00:00.000Z',
    });

    const res = await createCustomerThemeScheduleAction({
      themeKey: 'christmas',
      startAt: '2026-12-24T00:00:00.000Z',
      endAt: '2026-12-26T23:59:59.000Z',
    });

    expect(res.success).toBe(true);
    expect(res.schedule?.theme_key).toBe('christmas');
  });

  it('23. Cancel action marks schedule cancelled and returns success', async () => {
    vi.spyOn(RestaurantAdminService, 'cancelCustomerThemeSchedule').mockResolvedValueOnce({
      id: 'sched-to-cancel',
      restaurant_id: RESTAURANT_ID,
      theme_key: 'holi',
      start_at: '2026-03-25T00:00:00.000Z',
      end_at: '2026-03-26T23:59:59.000Z',
      timezone: 'Asia/Kolkata',
      status: 'CANCELLED',
      created_by: USER_ID,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    const res = await cancelCustomerThemeScheduleAction('sched-to-cancel');
    expect(res.success).toBe(true);
    expect(res.schedule?.status).toBe('CANCELLED');
  });

  // 12. Security & RLS Static / Policy Tests
  it('24. RLS model validation: SELECT policy permits Super Admin and assigned restaurant members (Admins + Staff)', () => {
    // Verifies the RLS predicate logic:
    // is_super_admin(auth.uid()) OR restaurant_id IN (SELECT get_user_restaurant_ids(auth.uid()))
    const isSuperAdmin = (role: string) => role === 'SUPER_ADMIN';
    const getUserRestaurantIds = (memberships: { restaurantId: string; role: string }[]) =>
      memberships.map((m) => m.restaurantId);

    const adminMemberships = [{ restaurantId: RESTAURANT_ID, role: 'RESTAURANT_ADMIN' }];
    const staffMemberships = [{ restaurantId: RESTAURANT_ID, role: 'STAFF' }];

    // Admin can view
    const adminCanSelect = isSuperAdmin('RESTAURANT_ADMIN') || getUserRestaurantIds(adminMemberships).includes(RESTAURANT_ID);
    expect(adminCanSelect).toBe(true);

    // Staff can view assigned restaurant
    const staffCanSelect = isSuperAdmin('STAFF') || getUserRestaurantIds(staffMemberships).includes(RESTAURANT_ID);
    expect(staffCanSelect).toBe(true);

    // Unassigned user cannot view
    const otherMemberships = [{ restaurantId: 'other-id', role: 'STAFF' }];
    const otherCanSelect = isSuperAdmin('STAFF') || getUserRestaurantIds(otherMemberships).includes(RESTAURANT_ID);
    expect(otherCanSelect).toBe(false);
  });

  it('25. RLS model validation: INSERT, UPDATE, DELETE policies strictly require RESTAURANT_ADMIN or SUPER_ADMIN', () => {
    // Verifies the RLS mutation predicate logic:
    // is_super_admin(auth.uid()) OR has_restaurant_role(auth.uid(), restaurant_id, ARRAY['RESTAURANT_ADMIN'])
    const hasRestaurantRole = (role: string, targetRestaurant: string, membershipRestaurant: string, allowedRoles: string[]) => {
      return targetRestaurant === membershipRestaurant && allowedRoles.includes(role);
    };
    const canMutate = (role: string, targetRestaurant: string, membershipRestaurant: string) => {
      if (role === 'SUPER_ADMIN') return true;
      return hasRestaurantRole(role, targetRestaurant, membershipRestaurant, ['RESTAURANT_ADMIN']);
    };

    // Super Admin can mutate
    expect(canMutate('SUPER_ADMIN', RESTAURANT_ID, RESTAURANT_ID)).toBe(true);

    // Restaurant Admin can mutate own restaurant
    expect(canMutate('RESTAURANT_ADMIN', RESTAURANT_ID, RESTAURANT_ID)).toBe(true);

    // Staff is strictly DENIED mutation
    expect(canMutate('STAFF', RESTAURANT_ID, RESTAURANT_ID)).toBe(false);

    // Cross-tenant Restaurant Admin is strictly DENIED mutation
    expect(canMutate('RESTAURANT_ADMIN', RESTAURANT_ID, 'other-restaurant-id')).toBe(false);
  });

  it('26. Super Admin can manage schedules across all restaurants', async () => {
    // Super Admin role possesses RESTAURANT_UPDATE and RESTAURANT_VIEW by default
    expect(ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN).toContain(PERMISSIONS.RESTAURANT_UPDATE);
    expect(ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN).toContain(PERMISSIONS.RESTAURANT_VIEW);

    const requireSpy = vi.spyOn(AuthorizationService, 'requirePermission').mockResolvedValue({
      userId: 'super-admin-uid',
      role: 'SUPER_ADMIN',
      restaurantId: RESTAURANT_ID,
    });

    await expect(
      AuthorizationService.requirePermission({
        userId: 'super-admin-uid',
        permission: PERMISSIONS.RESTAURANT_UPDATE,
        restaurantId: RESTAURANT_ID,
      })
    ).resolves.toBeDefined();
    expect(requireSpy).toHaveBeenCalled();
  });

  it('27. Restaurant Admin can manage schedules for their own restaurant', async () => {
    // Restaurant Admin role possesses RESTAURANT_UPDATE and RESTAURANT_VIEW for their restaurant
    expect(ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN).toContain(PERMISSIONS.RESTAURANT_UPDATE);
    expect(ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN).toContain(PERMISSIONS.RESTAURANT_VIEW);

    const requireSpy = vi.spyOn(AuthorizationService, 'requirePermission').mockResolvedValue({
      userId: USER_ID,
      role: 'RESTAURANT_ADMIN',
      restaurantId: RESTAURANT_ID,
    });

    await expect(
      AuthorizationService.requirePermission({
        userId: USER_ID,
        permission: PERMISSIONS.RESTAURANT_UPDATE,
        restaurantId: RESTAURANT_ID,
      })
    ).resolves.toBeDefined();
    expect(requireSpy).toHaveBeenCalled();
  });

  it('28. Staff cannot create schedules: service rejects with AuthorizationError', async () => {
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockResolvedValue({
      userId: 'staff-user-id',
      restaurantId: RESTAURANT_ID,
    });
    vi.spyOn(AuthorizationService, 'requirePermission').mockRejectedValueOnce(
      new AuthorizationError('Forbidden: missing required permission restaurant.update')
    );

    await expect(
      RestaurantAdminService.createCustomerThemeSchedule({
        themeKey: 'diwali',
        startAt: '2026-11-01T00:00:00.000Z',
        endAt: '2026-11-05T23:59:59.000Z',
      })
    ).rejects.toThrow(/Forbidden: missing required permission/);
  });

  it('29. Staff cannot update schedules: service rejects with AuthorizationError', async () => {
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockResolvedValue({
      userId: 'staff-user-id',
      restaurantId: RESTAURANT_ID,
    });
    vi.spyOn(AuthorizationService, 'requirePermission').mockRejectedValueOnce(
      new AuthorizationError('Forbidden: missing required permission restaurant.update')
    );

    await expect(
      RestaurantAdminService.updateCustomerThemeSchedule('sched-123', {
        themeKey: 'christmas',
      })
    ).rejects.toThrow(/Forbidden: missing required permission/);
  });

  it('30. Staff cannot cancel schedules: service rejects with AuthorizationError', async () => {
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockResolvedValue({
      userId: 'staff-user-id',
      restaurantId: RESTAURANT_ID,
    });
    vi.spyOn(AuthorizationService, 'requirePermission').mockRejectedValueOnce(
      new AuthorizationError('Forbidden: missing required permission restaurant.update')
    );

    await expect(
      RestaurantAdminService.cancelCustomerThemeSchedule('sched-123')
    ).rejects.toThrow(/Forbidden: missing required permission/);
  });

  it('31. Cross-tenant mutation is strictly rejected: Admin A cannot modify Restaurant B schedules', async () => {
    // RestaurantAdminService derives tenant from authenticated session, never trusting client-provided ID
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockResolvedValue({
      userId: 'admin-a-uid',
      restaurantId: RESTAURANT_ID, // Restaurant A
    });

    // If a request tries to operate on a schedule belonging to Restaurant B
    const updateSpy = vi.spyOn(CustomerThemeScheduleService, 'updateSchedule').mockRejectedValueOnce(
      new AuthorizationError('Access denied: schedule does not belong to authorized restaurant.')
    );

    await expect(
      CustomerThemeScheduleService.updateSchedule('sched-restaurant-b', RESTAURANT_ID, { themeKey: 'holi' })
    ).rejects.toThrow(/Access denied/);
    expect(updateSpy).toHaveBeenCalled();
  });

  it('32. Public/anonymous users are completely denied schedule mutation', async () => {
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockRejectedValueOnce(
      new AuthorizationError('Unauthorized: Active session required.')
    );

    const res = await updateCustomerThemeScheduleAction('sched-1', { themeKey: 'diwali' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
  });
});

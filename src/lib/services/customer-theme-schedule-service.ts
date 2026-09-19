import 'server-only';

import { createAdminClient } from '@/lib/db/supabase/admin';
import { isRegisteredTheme } from '@/lib/themes';
import { CacheService, CacheKeys } from '@/lib/cache';
import { logger } from '@/lib/logging/logger';
import { ValidationError, NotFoundError, DomainError } from '@/lib/errors';
import {
  zonedDateTimeToUtc,
  utcToZonedDateTime,
  getTimezoneLabel,
  validateScheduleInterval,
  resolveEffectiveThemeFromSchedules,
  type CustomerThemeSchedule,
  type CreateThemeScheduleInput,
  type UpdateThemeScheduleInput,
} from '@/lib/themes/scheduling';

export type { CustomerThemeSchedule, CreateThemeScheduleInput, UpdateThemeScheduleInput };

/**
 * Phase 5 — Canonical Customer Theme Scheduling Engine.
 *
 * Implements automatic date/time-based scheduling for QueueFlow customer themes.
 *
 * Invariants:
 * 1. Presentation configuration only — never mutates queue, order, or seating state.
 * 2. Exactly one schedule table: restaurant_customer_theme_schedules.
 * 3. Authoritative timezone: derived from restaurants.timezone (DST-safe Intl).
 * 4. Half-open interval semantics: [start_at, end_at) -> start_at <= now < end_at.
 * 5. Deterministic overlap prevention: overlapping active schedules are rejected.
 * 6. Fallback hierarchy: Active schedule -> Restaurant customer_theme_key -> default.
 * 7. Server-first & zero cron: activation is derived purely from timestamp `now`.
 */
export class CustomerThemeScheduleService {
  // Expose pure helpers on class for service callers & tests
  static zonedDateTimeToUtc = zonedDateTimeToUtc;
  static utcToZonedDateTime = utcToZonedDateTime;
  static getTimezoneLabel = getTimezoneLabel;
  static validateScheduleInterval = validateScheduleInterval;
  static resolveEffectiveThemeFromSchedules = resolveEffectiveThemeFromSchedules;

  /**
   * Check for overlapping active schedules for the given restaurant.
   * Half-open interval intersection: [A_start, A_end) && [B_start, B_end)
   * A intersects B iff A_start < B_end AND A_end > B_start.
   */
  static async checkScheduleOverlap(
    restaurantId: string,
    startAt: Date,
    endAt: Date,
    excludeScheduleId?: string
  ): Promise<void> {
    const adminClient = createAdminClient();
    let query = adminClient
      .from('restaurant_customer_theme_schedules')
      .select('id, theme_key, start_at, end_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'ACTIVE')
      .lt('start_at', endAt.toISOString())
      .gt('end_at', startAt.toISOString());

    if (excludeScheduleId) {
      query = query.neq('id', excludeScheduleId);
    }

    const { data: overlapping, error } = await query;

    if (error) {
      throw new DomainError(`Failed to verify schedule overlap: ${error.message}`);
    }

    if (overlapping && overlapping.length > 0) {
      const existing = overlapping[0];
      const themeName = existing ? existing.theme_key : 'existing';
      throw new ValidationError(
        `The selected schedule range overlaps with an existing active schedule ("${themeName}"). Overlapping active schedules are not permitted.`
      );
    }
  }

  /**
   * Fetch all schedules for a restaurant, sorted by start_at ASC.
   */
  static async listSchedulesForRestaurant(restaurantId: string): Promise<CustomerThemeSchedule[]> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('start_at', { ascending: true });

    if (error) {
      logger.error('Failed to list customer theme schedules', {
        operation: 'listSchedulesForRestaurant',
        error: error.message,
        restaurantId,
      });
      throw new DomainError(`Failed to fetch theme schedules: ${error.message}`);
    }

    return (data || []) as CustomerThemeSchedule[];
  }

  /**
   * Fetch active and upcoming schedules for theme resolution and cache boundary calculation.
   */
  static async getActiveAndUpcomingSchedules(
    restaurantId: string,
    now: Date = new Date()
  ): Promise<CustomerThemeSchedule[]> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'ACTIVE')
      .gt('end_at', now.toISOString())
      .order('start_at', { ascending: true });

    if (error) {
      logger.error('Failed to fetch active/upcoming schedules', {
        operation: 'getActiveAndUpcomingSchedules',
        error: error.message,
        restaurantId,
      });
      return [];
    }

    return (data || []) as CustomerThemeSchedule[];
  }

  /**
   * Create a new customer theme schedule.
   * Validates registered theme key, positive duration, and prevents overlaps.
   */
  static async createSchedule(
    restaurantId: string,
    input: CreateThemeScheduleInput,
    userId?: string
  ): Promise<CustomerThemeSchedule> {
    if (!input.themeKey || typeof input.themeKey !== 'string') {
      throw new ValidationError('Theme key is required.');
    }

    const normalizedThemeKey = input.themeKey.trim().toLowerCase();
    if (!isRegisteredTheme(normalizedThemeKey)) {
      throw new ValidationError(
        `Unknown theme key: "${input.themeKey}". Only approved registered themes can be scheduled.`
      );
    }

    const startAt = typeof input.startAt === 'string' ? new Date(input.startAt) : input.startAt;
    const endAt = typeof input.endAt === 'string' ? new Date(input.endAt) : input.endAt;

    validateScheduleInterval(startAt, endAt);

    // Resolve restaurant timezone & slug for cache invalidation
    const adminClient = createAdminClient();
    const { data: restaurant, error: restError } = await adminClient
      .from('restaurants')
      .select('id, slug, timezone')
      .eq('id', restaurantId)
      .single();

    if (restError || !restaurant) {
      throw new NotFoundError(`Restaurant ${restaurantId} not found.`);
    }

    const timezone = input.timezone || restaurant.timezone || 'UTC';

    // Check application-level overlap
    await this.checkScheduleOverlap(restaurantId, startAt, endAt);

    const { data: created, error: insertError } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .insert({
        restaurant_id: restaurantId,
        theme_key: normalizedThemeKey,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        timezone,
        status: 'ACTIVE',
        created_by: userId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (insertError) {
      // 23P01 is PostgreSQL exclusion_violation
      if (insertError.code === '23P01') {
        throw new ValidationError('The selected schedule range overlaps with an existing schedule. Concurrent overlap rejected.');
      }
      throw new DomainError(`Failed to create theme schedule: ${insertError.message}`);
    }

    // Invalidate public restaurant cache so customer QR updates immediately
    await CacheService.invalidate(CacheKeys.publicRestaurant(restaurant.slug));

    // Audit log
    await this.logAuditAction(
      'customer_theme_schedule_created',
      'restaurant_customer_theme_schedule',
      created.id,
      restaurantId,
      userId || null,
      {
        theme_key: normalizedThemeKey,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        timezone,
      }
    );

    return created as CustomerThemeSchedule;
  }

  /**
   * Update an existing theme schedule.
   */
  static async updateSchedule(
    scheduleId: string,
    restaurantId: string,
    input: UpdateThemeScheduleInput,
    userId?: string
  ): Promise<CustomerThemeSchedule> {
    const adminClient = createAdminClient();

    const { data: existing, error: fetchError } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .select('*')
      .eq('id', scheduleId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundError(`Theme schedule ${scheduleId} not found.`);
    }

    if (existing.status === 'CANCELLED') {
      throw new ValidationError('Cancelled schedules cannot be edited.');
    }

    let normalizedThemeKey = existing.theme_key;
    if (input.themeKey !== undefined) {
      if (!input.themeKey || typeof input.themeKey !== 'string') {
        throw new ValidationError('Theme key must be a non-empty string.');
      }
      normalizedThemeKey = input.themeKey.trim().toLowerCase();
      if (!isRegisteredTheme(normalizedThemeKey)) {
        throw new ValidationError(`Unknown theme key: "${input.themeKey}".`);
      }
    }

    const startAt = input.startAt !== undefined
      ? (typeof input.startAt === 'string' ? new Date(input.startAt) : input.startAt)
      : new Date(existing.start_at);

    const endAt = input.endAt !== undefined
      ? (typeof input.endAt === 'string' ? new Date(input.endAt) : input.endAt)
      : new Date(existing.end_at);

    validateScheduleInterval(startAt, endAt);

    // Overlap check excluding self
    await this.checkScheduleOverlap(restaurantId, startAt, endAt, scheduleId);

    const { data: updated, error: updateError } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .update({
        theme_key: normalizedThemeKey,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', scheduleId)
      .eq('restaurant_id', restaurantId)
      .select('*')
      .single();

    if (updateError) {
      if (updateError.code === '23P01') {
        throw new ValidationError('The updated schedule range overlaps with an existing schedule.');
      }
      throw new DomainError(`Failed to update theme schedule: ${updateError.message}`);
    }

    // Invalidate public restaurant cache
    const { data: restaurant } = await adminClient
      .from('restaurants')
      .select('slug')
      .eq('id', restaurantId)
      .single();

    if (restaurant?.slug) {
      await CacheService.invalidate(CacheKeys.publicRestaurant(restaurant.slug));
    }

    await this.logAuditAction(
      'customer_theme_schedule_updated',
      'restaurant_customer_theme_schedule',
      scheduleId,
      restaurantId,
      userId || null,
      {
        theme_key: normalizedThemeKey,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      }
    );

    return updated as CustomerThemeSchedule;
  }

  /**
   * Cancel an active or upcoming theme schedule.
   * Status is updated to CANCELLED and cache is immediately invalidated.
   */
  static async cancelSchedule(
    scheduleId: string,
    restaurantId: string,
    userId?: string
  ): Promise<CustomerThemeSchedule> {
    const adminClient = createAdminClient();

    const { data: existing, error: fetchError } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .select('*')
      .eq('id', scheduleId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundError(`Theme schedule ${scheduleId} not found.`);
    }

    const { data: cancelled, error: cancelError } = await adminClient
      .from('restaurant_customer_theme_schedules')
      .update({
        status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', scheduleId)
      .eq('restaurant_id', restaurantId)
      .select('*')
      .single();

    if (cancelError) {
      throw new DomainError(`Failed to cancel theme schedule: ${cancelError.message}`);
    }

    // Invalidate cache immediately so QR falls back to base theme
    const { data: restaurant } = await adminClient
      .from('restaurants')
      .select('slug')
      .eq('id', restaurantId)
      .single();

    if (restaurant?.slug) {
      await CacheService.invalidate(CacheKeys.publicRestaurant(restaurant.slug));
    }

    await this.logAuditAction(
      'customer_theme_schedule_cancelled',
      'restaurant_customer_theme_schedule',
      scheduleId,
      restaurantId,
      userId || null,
      {
        theme_key: existing.theme_key,
      }
    );

    return cancelled as CustomerThemeSchedule;
  }

  /**
   * Helper to write audit logs.
   */
  private static async logAuditAction(
    action: string,
    entityType: string,
    entityId: string,
    restaurantId: string,
    actorUserId: string | null,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      const adminClient = createAdminClient();
      await adminClient.from('audit_logs').insert({
        action,
        entity_type: entityType,
        entity_id: entityId,
        restaurant_id: restaurantId,
        actor_user_id: actorUserId,
        metadata,
      });
    } catch (error) {
      logger.error('Failed to insert audit log for theme schedule', {
        operation: 'audit_log',
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

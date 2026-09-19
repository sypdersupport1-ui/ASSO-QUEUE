import 'server-only';
import crypto from 'crypto';
import { createServerClient } from '@/lib/db/supabase/server';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  DomainError,
} from '@/lib/errors';
import { logger } from '@/lib/logging/logger';
import { z } from 'zod';
import type { RestaurantStatus } from '@/types/database.types';
import { CacheService, CacheKeys } from '@/lib/cache';
import { isRegisteredTheme } from '@/lib/themes/registry';

// Zod Validation Schemas
export const createRestaurantSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().default('UTC'),
  currency: z.string().default('USD'),
  dine_in_customer_ordering_enabled: z.boolean().optional(),
  dine_in_staff_ordering_enabled: z.boolean().optional(),
  takeaway_customer_ordering_enabled: z.boolean().optional(),
  takeaway_staff_ordering_enabled: z.boolean().optional(),
  takeaway_manual_ordering_enabled: z.boolean().optional(),
  customer_theme_key: z
    .string()
    .refine((key) => !key || isRegisteredTheme(key), {
      message: 'Must be an approved registered customer theme.',
    })
    .optional(),
});

export const updateRestaurantSchema = createRestaurantSchema.partial();

export const assignAdminSchema = z.object({
  restaurantId: z.string().uuid('Invalid restaurant ID'),
  email: z.string().email('Invalid email address'),
  displayName: z.string().min(2, 'Display name must be at least 2 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;
export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;
export type AssignAdminInput = z.infer<typeof assignAdminSchema>;

export class PlatformService {
  /**
   * Helper to record an audit log entry safely.
   */
  private static async logAuditAction(
    action: string,
    entityType: string,
    entityId: string,
    restaurantId: string | null,
    actorUserId: string,
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
      logger.error('Failed to insert audit log entry', {
        operation: 'audit_log',
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get live aggregate platform statistics for Super Admin dashboard.
   */
  static async getPlatformStats() {
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_VIEW });
    const supabase = await createServerClient();

    const { data: restaurants, error: rErr } = await supabase
      .from('restaurants')
      .select('status');

    if (rErr) throw new DomainError('Failed to fetch restaurant statistics');

    const totalRestaurants = restaurants.length;
    const activeRestaurants = restaurants.filter((r) => r.status === 'ACTIVE').length;
    const suspendedRestaurants = restaurants.filter((r) => r.status === 'SUSPENDED').length;
    const archivedRestaurants = restaurants.filter((r) => r.status === 'ARCHIVED').length;

    const { data: memberships, error: mErr } = await supabase
      .from('restaurant_memberships')
      .select('role, status')
      .eq('status', 'ACTIVE');

    if (mErr) throw new DomainError('Failed to fetch membership statistics');

    const totalAdmins = memberships.filter((m) => m.role === 'RESTAURANT_ADMIN').length;
    const totalStaff = memberships.filter((m) => m.role === 'STAFF').length;

    return {
      totalRestaurants,
      activeRestaurants,
      suspendedRestaurants,
      archivedRestaurants,
      totalAdmins,
      totalStaff,
    };
  }

  /**
   * Fetch paginated list of restaurants with search and status filters.
   */
  static async listRestaurants(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: RestaurantStatus;
  }) {
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_RESTAURANTS_VIEW });
    const supabase = await createServerClient();

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('restaurants')
      .select('*, restaurant_memberships(role, user_profiles(display_name, email))', {
        count: 'exact',
      });

    if (params.status) {
      query = query.eq('status', params.status);
    }

    if (params.search && params.search.trim() !== '') {
      const term = `%${params.search.trim()}%`;
      query = query.or(`name.ilike.${term},slug.ilike.${term},city.ilike.${term}`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new DomainError('Failed to retrieve restaurants');

    const restaurants = (data || []).map((r) => {
      const adminMembership = (r.restaurant_memberships || []).find(
        (m: { role: string }) => m.role === 'RESTAURANT_ADMIN'
      );
      const adminProfile = adminMembership
        ? (adminMembership as { user_profiles: { display_name: string; email: string } | null })
            .user_profiles
        : null;

      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        phone: r.phone,
        email: r.email,
        city: r.city,
        state: r.state,
        status: r.status,
        timezone: r.timezone,
        currency: r.currency,
        createdAt: r.created_at,
        assignedAdmin: adminProfile
          ? { name: adminProfile.display_name, email: adminProfile.email }
          : null,
      };
    });

    return {
      restaurants,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  /**
   * Get single restaurant details by ID along with operational counts.
   */
  static async getRestaurantById(id: string) {
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_RESTAURANTS_VIEW });
    const supabase = await createServerClient();

    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('*, restaurant_memberships(role, status, user_profiles(id, display_name, email, phone))')
      .eq('id', id)
      .single();

    if (error || !restaurant) {
      throw new NotFoundError(`Restaurant with ID ${id} not found`);
    }

    const adminMembership = (restaurant.restaurant_memberships || []).find(
      (m: { role: string; status: string }) =>
        m.role === 'RESTAURANT_ADMIN' && m.status === 'ACTIVE'
    );
    const adminProfile = adminMembership
      ? (adminMembership as { user_profiles: { id: string; display_name: string; email: string; phone: string } | null })
          .user_profiles
      : null;

    // Operational counts
    const [tablesRes, staffRes, menuRes, queueRes, ordersRes] = await Promise.all([
      supabase.from('restaurant_tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
      supabase.from('restaurant_memberships').select('id', { count: 'exact', head: true }).eq('restaurant_id', id).eq('role', 'STAFF').eq('status', 'ACTIVE'),
      supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
    ]);

    return {
      ...restaurant,
      assignedAdmin: adminProfile,
      counts: {
        tables: tablesRes.count || 0,
        staff: staffRes.count || 0,
        menuItems: menuRes.count || 0,
        queueEntries: queueRes.count || 0,
        orders: ordersRes.count || 0,
      },
    };
  }

  /**
   * Create a new restaurant.
   */
  static async createRestaurant(input: CreateRestaurantInput) {
    const userContext = await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_RESTAURANTS_CREATE });

    const parseResult = createRestaurantSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid restaurant creation data', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const normalizedSlug = data.slug.toLowerCase().trim();
    const supabase = await createServerClient();

    // Check slug uniqueness
    const { data: existing } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', normalizedSlug)
      .maybeSingle();

    if (existing) {
      throw new ConflictError(`Restaurant slug '${normalizedSlug}' is already taken`);
    }

    const { data: newRestaurant, error } = await supabase
      .from('restaurants')
      .insert({
        name: data.name.trim(),
        slug: normalizedSlug,
        description: data.description?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        city: data.city?.trim() || null,
        state: data.state?.trim() || null,
        country: data.country?.trim() || null,
        timezone: data.timezone || 'UTC',
        currency: data.currency || 'USD',
        status: 'ACTIVE',
      })
      .select()
      .single();

    if (error || !newRestaurant) {
      throw new DomainError('Failed to create restaurant record');
    }

    await this.logAuditAction(
      'restaurant_created',
      'restaurant',
      newRestaurant.id,
      newRestaurant.id,
      userContext.userId,
      { name: newRestaurant.name, slug: newRestaurant.slug }
    );

    return newRestaurant;
  }

  /**
   * Update restaurant metadata.
   */
  static async updateRestaurant(id: string, input: UpdateRestaurantInput) {
    const userContext = await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_RESTAURANTS_UPDATE });

    const parseResult = updateRestaurantSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid update data', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const supabase = await createServerClient();

    // Check existence
    const { data: existing } = await supabase
      .from('restaurants')
      .select('id, slug')
      .eq('id', id)
      .single();

    if (!existing) {
      throw new NotFoundError(`Restaurant ${id} not found`);
    }

    // Check slug uniqueness if changed
    if (data.slug && data.slug.toLowerCase().trim() !== existing.slug) {
      const normalizedSlug = data.slug.toLowerCase().trim();
      const { data: slugMatch } = await supabase
        .from('restaurants')
        .select('id')
        .eq('slug', normalizedSlug)
        .neq('id', id)
        .maybeSingle();

      if (slugMatch) {
        throw new ConflictError(`Slug '${normalizedSlug}' is already taken`);
      }
      data.slug = normalizedSlug;
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.slug !== undefined) updatePayload.slug = data.slug;
    if (data.description !== undefined) updatePayload.description = data.description?.trim() || null;
    if (data.phone !== undefined) updatePayload.phone = data.phone?.trim() || null;
    if (data.email !== undefined) updatePayload.email = data.email?.trim() || null;
    if (data.address !== undefined) updatePayload.address = data.address?.trim() || null;
    if (data.city !== undefined) updatePayload.city = data.city?.trim() || null;
    if (data.state !== undefined) updatePayload.state = data.state?.trim() || null;
    if (data.country !== undefined) updatePayload.country = data.country?.trim() || null;
    if (data.timezone !== undefined) updatePayload.timezone = data.timezone;
    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.dine_in_customer_ordering_enabled !== undefined) updatePayload.dine_in_customer_ordering_enabled = data.dine_in_customer_ordering_enabled;
    if (data.dine_in_staff_ordering_enabled !== undefined) updatePayload.dine_in_staff_ordering_enabled = data.dine_in_staff_ordering_enabled;
    if (data.takeaway_customer_ordering_enabled !== undefined) updatePayload.takeaway_customer_ordering_enabled = data.takeaway_customer_ordering_enabled;
    if (data.takeaway_staff_ordering_enabled !== undefined) updatePayload.takeaway_staff_ordering_enabled = data.takeaway_staff_ordering_enabled;
    if (data.takeaway_manual_ordering_enabled !== undefined) updatePayload.takeaway_manual_ordering_enabled = data.takeaway_manual_ordering_enabled;
    if (data.customer_theme_key !== undefined) {
      const key = data.customer_theme_key.trim().toLowerCase();
      if (!isRegisteredTheme(key)) {
        throw new ValidationError(`Unknown theme key: "${data.customer_theme_key}". Must be an approved registered theme.`);
      }
      updatePayload.customer_theme_key = key;
    }

    const { data: updated, error } = await supabase
      .from('restaurants')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new DomainError(`Failed to update restaurant: ${error.message}`);
    }

    const updatedRestaurant = updated;

    // Invalidate the public customer-facing cache
    await CacheService.invalidate(CacheKeys.publicRestaurant(updatedRestaurant.slug));

    await this.logAuditAction(
      'restaurant_updated',
      'restaurant',
      id,
      id,
      userContext.userId,
      updatePayload
    );

    return updated;
  }

  /**
   * Controlled state machine status updates (ACTIVE ↔ SUSPENDED, ACTIVE/SUSPENDED → ARCHIVED).
   */
  static async updateRestaurantStatus(id: string, targetStatus: RestaurantStatus) {
    const userContext = await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_RESTAURANTS_LIFECYCLE });

    const supabase = await createServerClient();
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name, status')
      .eq('id', id)
      .single();

    if (!restaurant) {
      throw new NotFoundError(`Restaurant ${id} not found`);
    }

    const currentStatus = restaurant.status as RestaurantStatus;

    if (currentStatus === targetStatus) {
      throw new DomainError(`Restaurant is already in '${targetStatus}' status`);
    }

    // State Machine Validation Rules
    if (currentStatus === 'ARCHIVED') {
      throw new DomainError('Archived restaurants cannot be reactivated or updated');
    }

    const validTransitions: Record<RestaurantStatus, RestaurantStatus[]> = {
      ACTIVE: ['SUSPENDED', 'ARCHIVED'],
      SUSPENDED: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: [],
    };

    if (!validTransitions[currentStatus]?.includes(targetStatus)) {
      throw new DomainError(
        `Invalid status transition from '${currentStatus}' to '${targetStatus}'`
      );
    }

    const updatePayload: Record<string, unknown> = {
      status: targetStatus,
      updated_at: new Date().toISOString(),
    };

    if (targetStatus === 'ARCHIVED') {
      updatePayload.archived_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from('restaurants')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError(`Failed to transition restaurant status to ${targetStatus}`);
    }

    const actionMap: Record<RestaurantStatus, string> = {
      ACTIVE: 'restaurant_activated',
      SUSPENDED: 'restaurant_suspended',
      ARCHIVED: 'restaurant_archived',
    };

    await this.logAuditAction(
      actionMap[targetStatus],
      'restaurant',
      id,
      id,
      userContext.userId,
      { previousStatus: currentStatus, newStatus: targetStatus }
    );

    return updated;
  }

  /**
   * Assign or invite a Restaurant Admin user to a restaurant.
   */
  static async assignRestaurantAdmin(input: AssignAdminInput) {
    const userContext = await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_RESTAURANTS_UPDATE });

    const parseResult = assignAdminSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid admin assignment input', {
        errors: parseResult.error.format(),
      });
    }

    const { restaurantId, email, displayName, password } = parseResult.data;
    const adminClient = createAdminClient();

    // Verify restaurant exists
    const { data: restaurant } = await adminClient
      .from('restaurants')
      .select('id, name')
      .eq('id', restaurantId)
      .maybeSingle();

    if (!restaurant) {
      throw new NotFoundError(`Restaurant ${restaurantId} not found`);
    }

    let targetUserId: string;

    // Check if user exists
    const { data: existingUser } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existingUser) {
      targetUserId = existingUser.id;
    } else {
      // Create user via Supabase Auth Admin API.
      // Phase 3E: never fall back to a guessable default password. When the
      // platform operator omits one, generate a cryptographic random value —
      // the account owner sets a real password via recovery/invitation.
      const effectivePassword =
        password && password.length >= 6
          ? password
          : crypto.randomBytes(24).toString('hex');
      const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password: effectivePassword,
        email_confirm: true,
        user_metadata: {
          role: 'RESTAURANT_ADMIN',
          restaurant_id: restaurantId,
        },
      });

      if (authErr || !authUser.user) {
        throw new DomainError(`Failed to create Auth user for ${email}: ${authErr?.message}`);
      }

      targetUserId = authUser.user.id;

      // Upsert profile
      await adminClient.from('user_profiles').upsert({
        id: targetUserId,
        display_name: displayName.trim(),
        email: email.toLowerCase().trim(),
      });
    }

    // Deactivate existing RESTAURANT_ADMIN memberships for this restaurant
    await adminClient
      .from('restaurant_memberships')
      .update({ status: 'INACTIVE', updated_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId)
      .eq('role', 'RESTAURANT_ADMIN');

    // Create or activate membership
    const { data: membership, error: mErr } = await adminClient
      .from('restaurant_memberships')
      .upsert(
        {
          user_id: targetUserId,
          restaurant_id: restaurantId,
          role: 'RESTAURANT_ADMIN',
          status: 'ACTIVE',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,restaurant_id,role' }
      )
      .select()
      .single();

    if (mErr || !membership) {
      throw new DomainError('Failed to record restaurant admin membership');
    }

    await this.logAuditAction(
      'restaurant_admin_assigned',
      'restaurant_membership',
      membership.id,
      restaurantId,
      userContext.userId,
      { assignedUserId: targetUserId, email, displayName }
    );

    return { success: true, targetUserId, membershipId: membership.id };
  }

  // ---------------------------------------------------------------------------
  // Hard delete (super admin only).
  //
  // Why this exists: the platform previously offered only ACTIVE <-> SUSPENDED
  // -> ARCHIVED lifecycle transitions — there was no way to remove a test /
  // duplicate / decommissioned tenant at all.
  //
  // Safety model:
  // - Requires PLATFORM_RESTAURANTS_DELETE (super admin only).
  // - Caller must supply the restaurant slug as confirmation (type-to-confirm
  //   in the UI). ARCHIVED-only is NOT enforced — an ACTIVE restaurant with a
  //   typo'd click is still protected by the slug check + dedicated button.
  // - Child rows go through ON DELETE CASCADE; payments are pre-deleted
  //   because payments.order_id is ON DELETE RESTRICT and would otherwise
  //   block the cascade.
  // - Auth accounts (auth.users / user_profiles) are deliberately KEPT — a
  //   person may work at several restaurants. Only their membership to the
  //   deleted restaurant is removed (via CASCADE).
  // - A `restaurant_deleted` audit entry is written with restaurant_id NULL
  //   (plus full snapshot in metadata) so the record survives the cascade.
  // ---------------------------------------------------------------------------
  static async deleteRestaurant(id: string, confirmSlug: string) {
    const userContext = await AuthorizationService.requirePermission({
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_DELETE,
    });

    const normalizedConfirm = (confirmSlug || '').toLowerCase().trim();
    if (!normalizedConfirm) {
      throw new ValidationError('Type the restaurant slug to confirm deletion.');
    }

    const adminClient = createAdminClient();
    const { data: restaurant } = await adminClient
      .from('restaurants')
      .select('id, name, slug, status')
      .eq('id', id)
      .maybeSingle();

    if (!restaurant) {
      throw new NotFoundError(`Restaurant ${id} not found`);
    }
    if (restaurant.slug.toLowerCase() !== normalizedConfirm) {
      throw new ValidationError(
        `Confirmation does not match. Type '${restaurant.slug}' to delete '${restaurant.name}'.`
      );
    }

    // Pre-delete the only RESTRICT chain: payments -> orders.
    // payment_events cascades from payments; everything else cascades from
    // restaurants directly.
    const { error: payErr } = await adminClient
      .from('payments')
      .delete()
      .eq('restaurant_id', id);
    if (payErr) {
      throw new DomainError(`Failed to delete restaurant payments: ${payErr.message}`);
    }

    const { error: delErr } = await adminClient
      .from('restaurants')
      .delete()
      .eq('id', id);
    if (delErr) {
      throw new DomainError(`Failed to delete restaurant: ${delErr.message}`);
    }

    await CacheService.invalidate(CacheKeys.publicRestaurant(restaurant.slug));

    await this.logAuditAction(
      'restaurant_deleted',
      'restaurant',
      id,
      null,
      userContext.userId,
      { name: restaurant.name, slug: restaurant.slug, previousStatus: restaurant.status }
    );

    return { success: true, slug: restaurant.slug, name: restaurant.name };
  }

  /**
   * Full team roster for a restaurant (admins + staff, every status).
   * Powers the super-admin detail page so the platform operator can see at a
   * glance who can access the tenant — previously invisible.
   */
  static async listRestaurantTeam(restaurantId: string) {
    await AuthorizationService.requirePermission({
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_VIEW,
    });
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('restaurant_memberships')
      .select('id, user_id, role, status, created_at, invited_at, invitation_accepted_at, user_profiles(id, display_name, email, phone)')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });

    if (error) throw new DomainError(`Failed to fetch restaurant team: ${error.message}`);

    return (data || []).map((m) => {
      const profile = m.user_profiles as unknown as {
        id: string;
        display_name: string;
        email: string;
        phone: string | null;
      } | null;
      return {
        membershipId: m.id,
        userId: m.user_id,
        role: m.role,
        status: m.status,
        createdAt: m.created_at,
        invitedAt: m.invited_at,
        invitationAcceptedAt: m.invitation_accepted_at,
        name: profile?.display_name || '—',
        email: profile?.email || '—',
        phone: profile?.phone || null,
      };
    });
  }

  /**
   * Recent audit trail scoped to one restaurant (for the detail page).
   */
  static async listRestaurantAudit(restaurantId: string, limit = 20) {
    await AuthorizationService.requirePermission({
      permission: PERMISSIONS.PLATFORM_AUDIT_VIEW,
    });
    const result = await this.listAuditLogs({
      page: 1,
      limit: Math.min(100, Math.max(1, limit)),
      restaurantId,
    });
    return result.logs;
  }

  /**
   * Seamless staff creation by the platform operator: creates the Auth user
   * with the given password and activates the membership immediately.
   *
   * This is intentionally different from the restaurant-admin invite flow
   * (email invitation + employee sets password). The super admin provisions
   * credentials directly and hands them to the operator — no inbox round-trip.
   */
  static async createTeamMemberDirect(input: {
    restaurantId: string;
    email: string;
    displayName: string;
    password: string;
    role: 'STAFF' | 'RESTAURANT_ADMIN';
  }) {
    const userContext = await AuthorizationService.requirePermission({
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_UPDATE,
    });

    const schema = z.object({
      restaurantId: z.string().uuid('Invalid restaurant ID'),
      email: z.string().email('Invalid email address'),
      displayName: z.string().min(2, 'Display name must be at least 2 characters'),
      password: z.string().min(6, 'Password must be at least 6 characters'),
      role: z.enum(['STAFF', 'RESTAURANT_ADMIN']),
    });
    const parseResult = schema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid team member data', {
        errors: parseResult.error.format(),
      });
    }
    const { restaurantId, email, displayName, password, role } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();
    const adminClient = createAdminClient();

    const { data: restaurant } = await adminClient
      .from('restaurants')
      .select('id, name')
      .eq('id', restaurantId)
      .maybeSingle();
    if (!restaurant) throw new NotFoundError(`Restaurant ${restaurantId} not found`);

    // Reuse an existing Auth account when the email is already known.
    const { data: existingProfile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    let targetUserId: string;
    if (existingProfile) {
      targetUserId = existingProfile.id;
      // Set / reset to the operator-supplied password so credentials are known.
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password,
        email_confirm: true,
        user_metadata: { role, restaurant_id: restaurantId },
      });
      if (pwErr) {
        throw new DomainError(`Failed to set password for ${normalizedEmail}: ${pwErr.message}`);
      }
    } else {
      const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { role, restaurant_id: restaurantId },
      });
      if (authErr || !authUser.user) {
        throw new DomainError(`Failed to create login for ${normalizedEmail}: ${authErr?.message}`);
      }
      targetUserId = authUser.user.id;
      await adminClient.from('user_profiles').upsert(
        { id: targetUserId, display_name: displayName.trim(), email: normalizedEmail },
        { onConflict: 'id' }
      );
    }

    const { data: membership, error: mErr } = await adminClient
      .from('restaurant_memberships')
      .upsert(
        {
          user_id: targetUserId,
          restaurant_id: restaurantId,
          role,
          status: 'ACTIVE',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,restaurant_id,role' }
      )
      .select()
      .single();

    if (mErr || !membership) {
      throw new DomainError(`Failed to activate team membership: ${mErr?.message}`);
    }

    await this.logAuditAction(
      'team_member_provisioned',
      'restaurant_membership',
      membership.id,
      restaurantId,
      userContext.userId,
      { assignedUserId: targetUserId, email: normalizedEmail, displayName, role }
    );

    return { success: true, targetUserId, membershipId: membership.id };
  }

  /**
   * Remove one team membership (super admin). The Auth account itself is kept
   * (shared identity); only access to this restaurant is revoked. INVITED
   * rows are cancelled; ACTIVE rows are deactivated.
   */
  static async removeTeamMember(restaurantId: string, targetUserId: string) {
    const userContext = await AuthorizationService.requirePermission({
      permission: PERMISSIONS.PLATFORM_RESTAURANTS_UPDATE,
    });
    const adminClient = createAdminClient();

    const { data: membership } = await adminClient
      .from('restaurant_memberships')
      .select('id, role, status')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', targetUserId)
      .neq('role', 'SUPER_ADMIN')
      .maybeSingle();

    if (!membership) {
      throw new NotFoundError('Team membership not found for this restaurant');
    }

    const { error } = await adminClient
      .from('restaurant_memberships')
      .update({ status: 'INACTIVE', updated_at: new Date().toISOString() })
      .eq('id', membership.id);
    if (error) throw new DomainError(`Failed to remove team member: ${error.message}`);

    await this.logAuditAction(
      membership.status === 'INVITED' ? 'STAFF_INVITATION_CANCELLED' : 'staff_deactivated',
      'restaurant_membership',
      membership.id,
      restaurantId,
      userContext.userId,
      { targetUserId, previousStatus: membership.status, removedBy: 'platform' }
    );

    return { success: true };
  }

  /**
   * One-shot tenant onboarding: restaurant + admin login + N staff logins.
   * Each step is best-effort atomic at its own level; failures roll the
   * whole tenant back (delete the created restaurant, cascading children)
   * so the platform never keeps a half-provisioned tenant.
   */
  static async createRestaurantWithTeam(input: {
    restaurant: CreateRestaurantInput;
    admin?: { email: string; displayName: string; password: string };
    staff?: Array<{ email: string; displayName: string; password: string; role: 'STAFF' | 'RESTAURANT_ADMIN' }>;
  }) {
    const restaurant = await this.createRestaurant(input.restaurant);

    const provisioned: Array<{ email: string; role: string }> = [];
    try {
      if (input.admin?.email) {
        await this.createTeamMemberDirect({
          restaurantId: restaurant.id,
          email: input.admin.email,
          displayName: input.admin.displayName,
          password: input.admin.password,
          role: 'RESTAURANT_ADMIN',
        });
        provisioned.push({ email: input.admin.email, role: 'RESTAURANT_ADMIN' });
      }
      for (const s of input.staff || []) {
        if (!s.email) continue;
        await this.createTeamMemberDirect({
          restaurantId: restaurant.id,
          email: s.email,
          displayName: s.displayName,
          password: s.password,
          role: s.role,
        });
        provisioned.push({ email: s.email, role: s.role });
      }
    } catch (teamErr) {
      // Roll back the tenant so a failed password / duplicate never leaves a
      // restaurant without its operator team.
      try {
        const adminClient = createAdminClient();
        await adminClient.from('payments').delete().eq('restaurant_id', restaurant.id);
        await adminClient.from('restaurants').delete().eq('id', restaurant.id);
      } catch {
        // Best effort — surface the original provisioning error below.
      }
      throw teamErr;
    }

    return { restaurant, provisioned };
  }

  // ---------------------------------------------------------------------------
  // Platform footfall analytics (super admin): how many people came, per
  // restaurant per day / per month. "People" = guests actually seated
  // (actual_guests confirmed at seat time, falling back to expected
  // party_size for rows seated before that column existed).
  // ---------------------------------------------------------------------------

  static async getFootfallAnalytics(params: {
    restaurantId?: string;
    fromISO: string;
    toISO: string;
    granularity: 'day' | 'month';
  }) {
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_VIEW });
    const adminClient = createAdminClient();

    const { restaurantId, fromISO, toISO, granularity } = params;
    const from = new Date(fromISO);
    const to = new Date(toISO);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new ValidationError('Invalid date range');
    }

    // Seated entries in range (seated_at = moment guests actually arrived).
    let seatedQuery = adminClient
      .from('queue_entries')
      .select('id, restaurant_id, party_size, actual_guests, seated_at, restaurants(name, slug)')
      .eq('status', 'SEATED')
      .gte('seated_at', from.toISOString())
      .lte('seated_at', to.toISOString())
      .order('seated_at', { ascending: true })
      .limit(20000);
    if (restaurantId) seatedQuery = seatedQuery.eq('restaurant_id', restaurantId);

    // Non-cancelled orders in range (kitchen demand + revenue alongside footfall).
    let ordersQuery = adminClient
      .from('orders')
      .select('id, restaurant_id, total, status, created_at')
      .neq('status', 'CANCELLED')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: true })
      .limit(20000);
    if (restaurantId) ordersQuery = ordersQuery.eq('restaurant_id', restaurantId);

    const [{ data: seated, error: sErr }, { data: orders, error: oErr }] = await Promise.all([
      seatedQuery,
      ordersQuery,
    ]);
    if (sErr) throw new DomainError(`Failed to fetch seating footfall: ${sErr.message}`);
    if (oErr) throw new DomainError(`Failed to fetch order footfall: ${oErr.message}`);

    return aggregateFootfall(
      (seated || []).map((e) => ({
        restaurantId: e.restaurant_id as string,
        restaurantName:
          (e.restaurants as unknown as { name?: string } | null)?.name || 'Unknown',
        partySize: (e.party_size as number) ?? 0,
        actualGuests: (e.actual_guests as number | null) ?? null,
        at: e.seated_at as string,
      })),
      (orders || []).map((o) => ({
        restaurantId: o.restaurant_id as string,
        total: Number(o.total) || 0,
        at: o.created_at as string,
      })),
      granularity,
      from,
      to
    );
  }

  /**
   * Retrieve paginated administrative audit logs.
   */
  static async listAuditLogs(params: {
    page?: number;
    limit?: number;
    restaurantId?: string;
    action?: string;
  }) {
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.PLATFORM_AUDIT_VIEW });
    const supabase = await createServerClient();

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('audit_logs')
      .select('*, user_profiles(display_name, email), restaurants(name, slug)', { count: 'exact' });

    if (params.restaurantId) {
      query = query.eq('restaurant_id', params.restaurantId);
    }

    if (params.action) {
      query = query.eq('action', params.action);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new DomainError('Failed to retrieve audit logs');

    const logs = (data || []).map((l) => {
      const userProfile = l.user_profiles as unknown as { display_name: string; email: string } | null;
      const restaurant = l.restaurants as unknown as { name: string; slug: string } | null;

      return {
        id: l.id,
        action: l.action,
        entityType: l.entity_type,
        entityId: l.entity_id,
        createdAt: l.created_at,
        metadata: l.metadata,
        actor: userProfile
          ? { name: userProfile.display_name, email: userProfile.email }
          : null,
        restaurant: restaurant
          ? { name: restaurant.name, slug: restaurant.slug }
          : null,
      };
    });

    return {
      logs,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }
}

// ---------------------------------------------------------------------------
// Pure footfall aggregation helpers (no DB — unit tested).
// Dates are bucketed in UTC; day buckets use YYYY-MM-DD, month buckets YYYY-MM.
// ---------------------------------------------------------------------------

export interface SeatedFootfallRow {
  restaurantId: string;
  restaurantName: string;
  partySize: number;
  actualGuests: number | null;
  at: string;
}

export interface OrderFootfallRow {
  restaurantId: string;
  total: number;
  at: string;
}

export interface FootfallBucket {
  key: string;
  label: string;
  groups: number;
  guests: number;
  expected: number;
  orders: number;
  revenue: number;
}

export interface RestaurantFootfall {
  restaurantId: string;
  restaurantName: string;
  groups: number;
  guests: number;
  expected: number;
  orders: number;
  revenue: number;
}

export function bucketKeyFor(at: string, granularity: 'day' | 'month'): string | null {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (granularity === 'month') return `${y}-${m}`;
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function bucketLabelFor(key: string, granularity: 'day' | 'month'): string {
  const parts = key.split('-').map(Number);
  if (granularity === 'month') {
    const [y = 1970, m = 1] = parts;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  const [y = 1970, m = 1, d = 1] = parts;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Fill every day/month key in [from, to] so charts/tables have no gaps. */
export function rangeKeys(from: Date, to: Date, granularity: 'day' | 'month'): string[] {
  const keys: string[] = [];
  const cursor =
    granularity === 'month'
      ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
      : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end =
    granularity === 'month'
      ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let guard = 0;
  while (cursor <= end && guard < 500) {
    keys.push(bucketKeyFor(cursor.toISOString(), granularity) as string);
    if (granularity === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return keys;
}

export function aggregateFootfall(
  seated: SeatedFootfallRow[],
  orders: OrderFootfallRow[],
  granularity: 'day' | 'month',
  from: Date,
  to: Date
): { buckets: FootfallBucket[]; byRestaurant: RestaurantFootfall[]; totals: Omit<FootfallBucket, 'key' | 'label'> } {
  const bucketMap = new Map<string, FootfallBucket>();
  for (const key of rangeKeys(from, to, granularity)) {
    bucketMap.set(key, {
      key,
      label: bucketLabelFor(key, granularity),
      groups: 0,
      guests: 0,
      expected: 0,
      orders: 0,
      revenue: 0,
    });
  }

  const restMap = new Map<string, RestaurantFootfall>();
  const rest = (id: string, name: string): RestaurantFootfall => {
    let r = restMap.get(id);
    if (!r) {
      r = { restaurantId: id, restaurantName: name, groups: 0, guests: 0, expected: 0, orders: 0, revenue: 0 };
      restMap.set(id, r);
    }
    return r;
  };

  const totals = { groups: 0, guests: 0, expected: 0, orders: 0, revenue: 0 };

  for (const e of seated) {
    const key = bucketKeyFor(e.at, granularity);
    if (!key) continue;
    const b = bucketMap.get(key);
    const guests = e.actualGuests ?? e.partySize ?? 0;
    if (b) {
      b.groups += 1;
      b.guests += guests;
      b.expected += e.partySize ?? 0;
    }
    const r = rest(e.restaurantId, e.restaurantName);
    r.groups += 1;
    r.guests += guests;
    r.expected += e.partySize ?? 0;
    totals.groups += 1;
    totals.guests += guests;
    totals.expected += e.partySize ?? 0;
  }

  for (const o of orders) {
    const key = bucketKeyFor(o.at, granularity);
    const b = key ? bucketMap.get(key) : undefined;
    if (b) {
      b.orders += 1;
      b.revenue += o.total;
    }
    const r = restMap.get(o.restaurantId);
    if (r) {
      r.orders += 1;
      r.revenue += o.total;
    }
    totals.orders += 1;
    totals.revenue += o.total;
  }

  const roundRevenue = (n: number) => Math.round(n * 100) / 100;
  return {
    buckets: [...bucketMap.values()].map((b) => ({ ...b, revenue: roundRevenue(b.revenue) })),
    byRestaurant: [...restMap.values()]
      .map((r) => ({ ...r, revenue: roundRevenue(r.revenue) }))
      .sort((a, b) => b.guests - a.guests),
    totals: { ...totals, revenue: roundRevenue(totals.revenue) },
  };
}

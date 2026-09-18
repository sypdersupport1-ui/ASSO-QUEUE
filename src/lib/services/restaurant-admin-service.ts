import 'server-only';
import { cache } from 'react';
import { createServerClient } from '@/lib/db/supabase/server';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { requireAuth } from '@/lib/auth/session';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
  DomainError,
} from '@/lib/errors';
import { logger } from '@/lib/logging/logger';
import { z } from 'zod';
import { CacheService, CacheKeys } from '@/lib/cache';


export const updateRestaurantProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().default('UTC'),
  currency: z.string().default('USD'),
  seating_mode: z.enum(['SIMPLE', 'STRICT']).default('SIMPLE'),
  takeaway_enabled: z.boolean().optional(),
  dine_in_customer_ordering_enabled: z.boolean().optional(),
  dine_in_staff_ordering_enabled: z.boolean().optional(),
  takeaway_customer_ordering_enabled: z.boolean().optional(),
  takeaway_staff_ordering_enabled: z.boolean().optional(),
});

/**
 * Roles a restaurant admin may grant through staff invitation.
 *
 * SUPER_ADMIN is deliberately NOT a member of this enum: a restaurant admin
 * must never be able to grant platform privileges. Platform elevation stays
 * with the existing platform-service Super Admin flow.
 */
export const INVITABLE_STAFF_ROLES = ['STAFF', 'RESTAURANT_ADMIN'] as const;
export type InvitableStaffRole = (typeof INVITABLE_STAFF_ROLES)[number];

export const createStaffSchema = z.object({
  email: z.string().email('Invalid email address'),
  displayName: z.string().min(2, 'Display name must be at least 2 characters'),
  role: z.enum(INVITABLE_STAFF_ROLES).default('STAFF'),
});

export type UpdateRestaurantProfileInput = z.infer<typeof updateRestaurantProfileSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Module-level cached implementation of getAuthorizedRestaurantContext.
 * React cache() memoizes this per request — the membership DB query only fires once
 * even if multiple services call getAuthorizedRestaurantContext() in the same action.
 */
const _getAuthorizedRestaurantContext = cache(
  async (): Promise<{ userId: string; restaurantId: string }> => {
    const user = await requireAuth();
    const supabase = await createServerClient();

    const { data: membership, error } = await supabase
      .from('restaurant_memberships')
      .select('restaurant_id, role, status')
      .eq('user_id', user.id)
      .eq('role', 'RESTAURANT_ADMIN')
      .eq('status', 'ACTIVE')
      .not('restaurant_id', 'is', null)
      .maybeSingle();

    if (error || !membership || !membership.restaurant_id) {
      throw new AuthorizationError('Access denied. Active Restaurant Admin membership required.');
    }

    // Phase 3E: suspended/archived restaurants cannot operate, even with a
    // valid ACTIVE membership. Platform super-admin paths do not use this
    // context and are unaffected.
    await RestaurantAdminService.assertRestaurantActive(membership.restaurant_id);

    return {
      userId: user.id,
      restaurantId: membership.restaurant_id,
    };
  }
);

export class RestaurantAdminService {

  /**
   * Resolve authorized restaurant ID for current authenticated Restaurant Admin from DB.
   * NEVER trust restaurant_id from client requests.
   *
   * PERFORMANCE: Wrapped with React cache() via the module-level helper below.
   * The membership DB query is executed at most once per server action/render,
   * regardless of how many services call this method.
   */
  static getAuthorizedRestaurantContext = _getAuthorizedRestaurantContext;

  /**
   * Phase 3E: assert a restaurant is lifecycle-ACTIVE (not SUSPENDED /
   * ARCHIVED). Live-testable without a session (takes an explicit id);
   * called by getAuthorizedRestaurantContext and loginAction.
   */
  static async assertRestaurantActive(restaurantId: string): Promise<void> {
    const adminClient = createAdminClient();
    const { data: restaurant } = await adminClient
      .from('restaurants')
      .select('status')
      .eq('id', restaurantId)
      .maybeSingle();
    if (!restaurant || restaurant.status !== 'ACTIVE') {
      throw new AuthorizationError('This restaurant is not currently active.');
    }
  }


  /**
   * Log an audit action safely.
   */
  private static async logAuditAction(
    action: string,
    entityType: string,
    entityId: string,
    restaurantId: string,
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
      logger.error('Failed to insert audit log', {
        operation: 'audit_log',
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Lightweight fetch for layout header (only restaurant, no counts) — snappy.
   */
  static getRestaurantForLayout = cache(async () => {
    const { restaurantId } = await _getAuthorizedRestaurantContext();
    const supabase = await createServerClient();
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('id, name, slug, avg_service_time_mins, service_capacity_units')
      .eq('id', restaurantId)
      .single();
    if (error || !restaurant) throw new NotFoundError(`Restaurant ${restaurantId} not found`);
    return { restaurant, restaurantId };
  });

  /**
   * Get restaurant admin dashboard stats & metadata.
   */
  static async getRestaurantDashboardStats() {
    const { restaurantId } = await this.getAuthorizedRestaurantContext();
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.RESTAURANT_VIEW, restaurantId });
    const supabase = await createServerClient();

    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', restaurantId)
      .single();

    if (error || !restaurant) {
      throw new NotFoundError(`Restaurant ${restaurantId} not found`);
    }

    const [tablesRes, staffRes, menuRes, queueRes, ordersRes] = await Promise.all([
      supabase.from('restaurant_tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      supabase.from('restaurant_memberships').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('role', 'STAFF').eq('status', 'ACTIVE'),
      supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
    ]);

    return {
      restaurant,
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
   * Update restaurant profile metadata (permitted fields only).
   */
  static async updateRestaurantProfile(input: UpdateRestaurantProfileInput) {
    const { userId, restaurantId } = await this.getAuthorizedRestaurantContext();
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.RESTAURANT_UPDATE, restaurantId });

    const parseResult = updateRestaurantProfileSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid profile data', {
        errors: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const adminClient = createAdminClient();

    const updatePayload = {
      name: data.name.trim(),
      description: data.description?.trim() || null,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      city: data.city?.trim() || null,
      state: data.state?.trim() || null,
      country: data.country?.trim() || null,
      timezone: data.timezone,
      currency: data.currency,
      seating_mode: data.seating_mode,
      ...(data.takeaway_enabled !== undefined ? { takeaway_enabled: data.takeaway_enabled } : {}),
      ...(data.dine_in_customer_ordering_enabled !== undefined ? { dine_in_customer_ordering_enabled: data.dine_in_customer_ordering_enabled } : {}),
      ...(data.dine_in_staff_ordering_enabled !== undefined ? { dine_in_staff_ordering_enabled: data.dine_in_staff_ordering_enabled } : {}),
      ...(data.takeaway_customer_ordering_enabled !== undefined ? { takeaway_customer_ordering_enabled: data.takeaway_customer_ordering_enabled } : {}),
      ...(data.takeaway_staff_ordering_enabled !== undefined ? { takeaway_staff_ordering_enabled: data.takeaway_staff_ordering_enabled } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await adminClient
      .from('restaurants')
      .update(updatePayload)
      .eq('id', restaurantId)
      .select('slug')
      .single();

    if (error) {
      throw new DomainError(`Failed to update restaurant profile: ${error.message}`);
    }

    const updatedRestaurant = updated;
    await CacheService.invalidate(CacheKeys.publicRestaurant(updatedRestaurant.slug));

    await this.logAuditAction(
      'profile_updated',
      'restaurant',
      restaurantId,
      restaurantId,
      userId,
      updatePayload
    );
  }

  /**
   * Fetch paginated list of staff members for authorized restaurant.
   */
  static async listStaff(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: 'ACTIVE' | 'INVITED' | 'INACTIVE';
  }) {
    const { restaurantId } = await this.getAuthorizedRestaurantContext();
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.STAFF_VIEW, restaurantId });
    const supabase = await createServerClient();

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const offset = (page - 1) * limit;

    // Staff management covers both floor staff and restaurant admins.
    // SUPER_ADMIN memberships are platform-scoped and never listed here.
    let query = supabase
      .from('restaurant_memberships')
      .select('*, user_profiles(display_name, email, phone)', { count: 'exact' })
      .eq('restaurant_id', restaurantId)
      .in('role', [...INVITABLE_STAFF_ROLES]);

    if (params.status) {
      query = query.eq('status', params.status);
    } else {
      // Default: show all statuses (ACTIVE, INVITED, INACTIVE)
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new DomainError('Failed to retrieve staff members');

    let staff = (data || []).map((m) => {
      const profile = (m.user_profiles as unknown) as {
        display_name: string;
        email: string;
        phone: string;
      } | null;

      return {
        id: m.id,
        userId: m.user_id,
        name: profile?.display_name || 'Staff Member',
        email: profile?.email || '-',
        phone: profile?.phone || '-',
        role: m.role,
        status: m.status,
        createdAt: m.created_at,
        invitedAt: m.invited_at,
      };
    });

    if (params.search && params.search.trim() !== '') {
      const term = params.search.trim().toLowerCase();
      staff = staff.filter(
        (s) =>
          s.name.toLowerCase().includes(term) || s.email.toLowerCase().includes(term)
      );
    }

    return {
      staff,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  /**
 * Create / Invite a new staff member (STAFF or RESTAURANT_ADMIN).
 *
 * Invitation flow (Supabase Auth owns the credential — no custom tokens):
 * 1. Authorization + validation first (never trust browser restaurant context).
 * 2. inviteUserByEmail() sends a secure invitation email.
 *    - New Auth user  -> created, then invited.
 *    - Existing user  -> user_metadata refreshed, fresh invitation sent.
 * 3. Membership upserted with status INVITED (never ACTIVE at this point).
 * 4. Employee clicks the link -> /auth/confirm -> /auth/accept-invitation ->
 *    sets password -> INVITED becomes ACTIVE (see staff-invitation-service).
 *
 * Consistency model: Auth and Postgres are NOT one transaction. Ordering is
 * authorize -> invite -> persist membership -> audit, with deterministic
 * retry semantics (upsert on user_id/restaurant_id/role; resend reuses the
 * same Auth user and membership — never duplicates).
 */
  static async createStaff(input: CreateStaffInput) {
    const { userId, restaurantId } = await this.getAuthorizedRestaurantContext();
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.STAFF_CREATE, restaurantId });

    const parseResult = createStaffSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError('Invalid staff creation input', {
        errors: parseResult.error.format(),
      });
    }

    const { email, displayName, role } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();
    const adminClient = createAdminClient();

    // Defense in depth: the schema enum already excludes SUPER_ADMIN, but a
    // tampered role must never escalate to platform privileges.
    if (!INVITABLE_STAFF_ROLES.includes(role as InvitableStaffRole)) {
      throw new AuthorizationError('Role is not permitted for staff invitation.');
    }

    // Rate limit invitation creation: restaurant + actor scoped.
    // Authenticated admin operation — customer QR limits do NOT apply.
    const { checkRateLimit, RateLimitEndpointClass, RateLimitLimit, generateStaffInviteIdentifier } =
      await import('@/lib/rate-limit');
    const createLimit = await checkRateLimit({
      identifier: generateStaffInviteIdentifier(restaurantId, userId),
      limit: RateLimitLimit.STAFF_INVITE_CREATE,
      windowSeconds: 3600,
      endpointClass: RateLimitEndpointClass.AUTHENTICATED_ADMIN,
    });
    if (!createLimit.allowed) {
      throw new DomainError(
        'Too many invitations sent recently. Please wait before inviting more staff.'
      );
    }

    // Case C: email already belongs to an ACTIVE member of this restaurant
    // with the same role -> controlled duplicate error (no new invite).
    const { data: existingActiveMembership, error: activeMemErr } = await adminClient
      .from('restaurant_memberships')
      .select('id, status, role, user_id')
      .eq('restaurant_id', restaurantId)
      .eq('role', role)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (!activeMemErr && existingActiveMembership) {
      throw new DomainError('This email already belongs to an active member of this restaurant.');
    }

    const { getEnv } = await import('@/lib/config/env');
    const appUrl = getEnv().server.APPLICATION_URL;

    const { data: inviteResult, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        data: {
          role,
          restaurant_id: restaurantId,
        },
        // Lands on the in-app callback, which exchanges the session and
        // forwards (allowlisted) to the onboarding page.
        // NOTE: this URL must be allowlisted in Supabase Auth "Redirect URLs".
        redirectTo: `${appUrl}/auth/confirm?next=/auth/accept-invitation`,
      }
    );

    if (inviteErr || !inviteResult.user) {
      // Surface a safe error: never expose Auth internals or whether the
      // email exists globally in Auth.
      logger.warn('Staff invitation delivery failed', {
        operation: 'staff_invite',
        metadata: { restaurantId },
      });
      throw new DomainError(
        'Failed to send the invitation. Please verify the email address and try again.'
      );
    }

    const targetUserId = inviteResult.user.id;

    // The requested role IS the assigned role (no silent downgrade/upgrade).
    const { data: membership, error: mErr } = await adminClient
      .from('restaurant_memberships')
      .upsert(
        {
          user_id: targetUserId,
          restaurant_id: restaurantId,
          role,
          status: 'INVITED',
          invited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,restaurant_id,role' }
      )
      .select()
      .single();

    if (mErr || !membership) {
      // Partial failure: the Auth invitation may already be sent while the
      // membership write failed. The membership upsert is idempotent, so a
      // retry (or resend) reconciles deterministically — no duplicate Auth
      // user is created because inviteUserByEmail reuses the existing one.
      throw new DomainError(
        'Invitation sent but membership could not be recorded. Please retry — no duplicate account will be created.'
      );
    }

    // Ensure the user_profiles row exists for list rendering (best-effort;
    // the profile is owned by the employee's account data, not secrets).
    try {
      await adminClient.from('user_profiles').upsert(
        {
          id: targetUserId,
          display_name: displayName.trim(),
          email: normalizedEmail,
        },
        { onConflict: 'id' }
      );
    } catch {
      // Non-fatal: the membership + invitation are the source of truth.
    }

    await this.logAuditAction(
      'STAFF_INVITED',
      'restaurant_membership',
      membership.id,
      restaurantId,
      userId,
      { targetUserId, email: normalizedEmail, displayName, role, invitedAt: membership.invited_at }
    );

    return { success: true, targetUserId, membershipId: membership.id, invitationSent: true };
  }

  /**
   * Resend a staff invitation (existing INVITED membership only).
   *
   * Semantics: same Auth user + same membership + fresh Supabase invitation +
   * refreshed invited_at. Never creates another account or membership, and
   * never activates the membership (activation happens only on employee
   * acceptance via /auth/accept-invitation).
   */
  static async resendStaffInvitation(targetUserId: string) {
    const { userId, restaurantId } = await this.getAuthorizedRestaurantContext();
    await AuthorizationService.requirePermission({ permission: PERMISSIONS.STAFF_CREATE, restaurantId });
    const adminClient = createAdminClient();

    // Resolve the target membership server-side — never trust browser ids
    // beyond identifying WHICH membership; restaurant scoping is enforced here.
    const { data: membership, error: memErr } = await adminClient
      .from('restaurant_memberships')
      .select('id, user_id, restaurant_id, role, status')
      .eq('user_id', targetUserId)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'INVITED')
      .maybeSingle();

    if (memErr || !membership) {
      throw new NotFoundError(
        'No pending invitation found for this staff member in your restaurant.'
      );
    }

    const { checkRateLimit, RateLimitEndpointClass, RateLimitLimit, generateStaffResendIdentifier } =
      await import('@/lib/rate-limit');
    const resendLimit = await checkRateLimit({
      identifier: generateStaffResendIdentifier(membership.id),
      limit: RateLimitLimit.STAFF_INVITE_RESEND,
      windowSeconds: 3600,
      endpointClass: RateLimitEndpointClass.AUTHENTICATED_ADMIN,
    });
    if (!resendLimit.allowed) {
      throw new DomainError(
        'Invitation resend limit reached for this staff member. Please try again later.'
      );
    }

    // Look up the Auth email for the existing user (no new account created).
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('email')
      .eq('id', targetUserId)
      .maybeSingle();
    const targetEmail = profile?.email?.toLowerCase?.().trim();
    if (!targetEmail) {
      throw new DomainError('Cannot resend: no email address on record for this staff member.');
    }

    const { getEnv } = await import('@/lib/config/env');
    const appUrl = getEnv().server.APPLICATION_URL;

    const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(targetEmail, {
      data: {
        role: membership.role,
        restaurant_id: restaurantId,
      },
      redirectTo: `${appUrl}/auth/confirm?next=/auth/accept-invitation`,
    });

    if (inviteErr) {
      logger.warn('Staff invitation resend failed', {
        operation: 'staff_invite_resend',
        metadata: { restaurantId, membershipId: membership.id },
      });
      throw new DomainError('Failed to resend the invitation. Please try again later.');
    }

    await adminClient
      .from('restaurant_memberships')
      .update({
        invited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', membership.id);

    await this.logAuditAction(
      'STAFF_INVITATION_RESENT',
      'restaurant_membership',
      membership.id,
      restaurantId,
      userId,
      { targetUserId }
    );

    return { success: true, membershipId: membership.id };
  }

  /**
   * Activate / deactivate / cancel-invitation for a staff member.
   *
   * INVITED -> ACTIVE through this path is FORBIDDEN: only the employee's
   * own acceptance (password set via Supabase Auth + acceptStaffInvitation)
   * may activate an invitation. An admin clicking "Activate" must never be
   * presented as, or equivalent to, invitation acceptance.
   * INVITED -> INACTIVE is allowed and means "cancel the invitation".
   */
  static async updateStaffStatus(targetUserId: string, newStatus: 'ACTIVE' | 'INACTIVE') {
    const { userId, restaurantId } = await this.getAuthorizedRestaurantContext();
    const requiredPerm = newStatus === 'ACTIVE' ? PERMISSIONS.STAFF_ACTIVATE : PERMISSIONS.STAFF_DEACTIVATE;
    await AuthorizationService.requirePermission({ permission: requiredPerm, restaurantId });
    const adminClient = createAdminClient();

    // Membership must belong to this restaurant; SUPER_ADMIN rows are
    // platform-scoped and never manageable from here.
    const { data: existing } = await adminClient
      .from('restaurant_memberships')
      .select('id, status, role')
      .eq('user_id', targetUserId)
      .eq('restaurant_id', restaurantId)
      .in('role', [...INVITABLE_STAFF_ROLES])
      .maybeSingle();

    if (!existing) {
      throw new NotFoundError('Staff membership not found for this restaurant');
    }

    if (existing.status === 'INVITED' && newStatus === 'ACTIVE') {
      throw new DomainError(
        'This invitation has not been accepted yet. Activation happens when the staff member sets their password via the invitation link — use Resend Invitation instead.'
      );
    }

    if (existing.status === newStatus) {
      throw new DomainError(`Staff member is already ${newStatus}`);
    }

    const { data: updated, error } = await adminClient
      .from('restaurant_memberships')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error || !updated) {
      throw new DomainError(`Failed to update staff status to ${newStatus}`);
    }

    const actionName =
      existing.status === 'INVITED' && newStatus === 'INACTIVE'
        ? 'STAFF_INVITATION_CANCELLED'
        : newStatus === 'ACTIVE'
          ? 'staff_activated'
          : 'staff_deactivated';

    await this.logAuditAction(
      actionName,
      'restaurant_membership',
      existing.id,
      restaurantId,
      userId,
      { targetUserId, previousStatus: existing.status, newStatus }
    );

    return updated;
  }
}

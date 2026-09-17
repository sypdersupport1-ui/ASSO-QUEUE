import 'server-only';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { logger } from '@/lib/logging/logger';
import { DomainError } from '@/lib/errors';

/**
 * Phase 3C — Staff invitation acceptance service.
 *
 * Single authoritative place where INVITED -> ACTIVE happens.
 * Activation is ALWAYS scoped to the authenticated user and — when the Auth
 * user_metadata carries the invitation context — to the invited restaurant.
 * Browser-supplied restaurant_id / role / membership_id are NEVER trusted.
 */

export interface InvitedMembership {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  role: string;
  status: string;
}

export interface AcceptInvitationResult {
  activatedMembershipIds: string[];
  alreadyActive: boolean;
  dashboardPath: string;
}

/**
 * Paths the invitation callback / onboarding flow may redirect to.
 * Anything else is rejected (no open redirects).
 */
const ALLOWED_REDIRECT_PATHS = new Set([
  '/auth/accept-invitation',
  '/dashboard',
  '/dashboard/operational',
  '/login',
]);

/**
 * Resolve a post-auth redirect target safely.
 * Returns the allowlisted path, or the default onboarding page.
 * Pure function — unit tested.
 */
export function resolveSafeRedirect(rawNext: string | null | undefined): string {
  const fallback = '/auth/accept-invitation';
  if (!rawNext) return fallback;
  let parsed: URL;
  try {
    // A base is required; absolute URLs with other origins are rejected below.
    parsed = new URL(rawNext, 'http://internal');
  } catch {
    return fallback;
  }
  if (parsed.origin !== 'http://internal') return fallback;
  const path = parsed.pathname;
  // Reject protocol-relative tricks and non-allowlisted destinations.
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  if (!ALLOWED_REDIRECT_PATHS.has(path)) return fallback;
  return path;
}

/**
 * Dashboard landing path for a staff role after onboarding.
 * Pure function — unit tested.
 */
export function dashboardPathForRole(role: string | null | undefined): string {
  if (role === 'RESTAURANT_ADMIN') return '/dashboard';
  if (role === 'SUPER_ADMIN') return '/platform';
  return '/dashboard/operational';
}

/**
 * Scope INVITED memberships to the legitimate invitation context.
 * - When the Auth user_metadata carries the invited restaurant_id, only
 *   memberships for that restaurant are eligible (multi-tenant safety).
 * - When metadata is absent (legacy/edge), all of the user's own INVITED
 *   memberships are eligible — they could only have been created by an
 *   authorized inviter.
 * Pure function — unit tested.
 */
export function selectInvitableMemberships(
  invited: InvitedMembership[],
  metadataRestaurantId: string | null | undefined
): InvitedMembership[] {
  const own = invited.filter((m) => m.status === 'INVITED');
  if (!metadataRestaurantId) return own;
  return own.filter((m) => m.restaurant_id === metadataRestaurantId);
}

async function logAuditAction(
  action: string,
  entityId: string,
  restaurantId: string | null,
  actorUserId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const adminClient = createAdminClient();
    await adminClient.from('audit_logs').insert({
      action,
      entity_type: 'restaurant_membership',
      entity_id: entityId,
      restaurant_id: restaurantId,
      actor_user_id: actorUserId,
      metadata,
    });
  } catch (error) {
    // Audit failure must not break acceptance; it is logged for operators.
    logger.error('Failed to insert invitation audit log', {
      operation: 'staff_invitation_audit',
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Accept a staff invitation for the AUTHENTICATED user.
 *
 * @param userId Supabase Auth user id resolved from the server session.
 *   Never accept a user id, membership id, restaurant id, or role from the browser.
 */
export async function acceptInvitationForUser(userId: string): Promise<AcceptInvitationResult> {
  if (!userId) {
    throw new DomainError('Authentication required to accept an invitation.');
  }
  const adminClient = createAdminClient();

  // Trusted invitation context from Auth — not from query params.
  let metadataRestaurantId: string | null = null;
  try {
    const { data: authUserData } = await adminClient.auth.admin.getUserById(userId);
    const meta = authUserData?.user?.user_metadata as
      | { restaurant_id?: unknown }
      | null
      | undefined;
    if (typeof meta?.restaurant_id === 'string' && meta.restaurant_id.length > 0) {
      metadataRestaurantId = meta.restaurant_id;
    }
  } catch {
    // If Auth lookup fails, fall back to the user's own INVITED rows.
    metadataRestaurantId = null;
  }

  const { data: invitedRows, error: invitedErr } = await adminClient
    .from('restaurant_memberships')
    .select('id, user_id, restaurant_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'INVITED');

  if (invitedErr) {
    throw new DomainError('Failed to look up pending invitations.');
  }

  const eligible = selectInvitableMemberships(
    (invitedRows ?? []) as InvitedMembership[],
    metadataRestaurantId
  );

  if (eligible.length === 0) {
    // No pending invitation: either already onboarded or invalid link.
    const { data: activeRows } = await adminClient
      .from('restaurant_memberships')
      .select('id, role')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .limit(10);
    const actives = (activeRows ?? []) as Array<{ id: string; role: string }>;
    if (actives.length > 0) {
      const topRole = actives.some((m) => m.role === 'RESTAURANT_ADMIN')
        ? 'RESTAURANT_ADMIN'
        : actives[0]?.role ?? 'STAFF';
      return {
        activatedMembershipIds: [],
        alreadyActive: true,
        dashboardPath: dashboardPathForRole(topRole),
      };
    }
    throw new DomainError(
      'No pending invitation found for this account. The invitation may have expired or already been used.'
    );
  }

  const now = new Date().toISOString();
  const activatedIds: string[] = [];

  for (const membership of eligible) {
    const { error: updateErr } = await adminClient
      .from('restaurant_memberships')
      .update({
        status: 'ACTIVE',
        invitation_accepted_at: now,
        updated_at: now,
      })
      .eq('id', membership.id)
      .eq('user_id', userId) // belt-and-braces: never touch another user's row
      .eq('status', 'INVITED'); // idempotent guard: only transition from INVITED

    if (updateErr) {
      logger.error('Failed to activate invited membership', {
        operation: 'staff_invitation_accept',
        metadata: { membershipId: membership.id },
        error: updateErr.message,
      });
      continue;
    }
    activatedIds.push(membership.id);
    await logAuditAction(
      'STAFF_INVITATION_ACCEPTED',
      membership.id,
      membership.restaurant_id,
      userId,
      { role: membership.role }
    );
  }

  if (activatedIds.length === 0) {
    throw new DomainError('Failed to activate the invitation. Please try again or contact your administrator.');
  }

  const topRole = eligible.some((m) => m.role === 'RESTAURANT_ADMIN')
    ? 'RESTAURANT_ADMIN'
    : eligible[0]?.role ?? 'STAFF';

  logger.info('Staff invitation accepted', {
    operation: 'staff_invitation_accept',
    metadata: {
      activatedCount: activatedIds.length,
      role: topRole,
    },
  });

  return {
    activatedMembershipIds: activatedIds,
    alreadyActive: false,
    dashboardPath: dashboardPathForRole(topRole),
  };
}

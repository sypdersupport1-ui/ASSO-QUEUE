'use server';

import { requireAuth } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { DomainError } from '@/lib/errors';

/**
 * Phase 3C — finalize a staff invitation acceptance.
 *
 * Called AFTER the employee sets their password through Supabase Auth
 * (browser -> Supabase directly; the password never touches app code).
 *
 * Security: the ONLY input is the server session. No restaurant_id, role,
 * membership_id, or user_id is accepted from the browser.
 */
export async function acceptStaffInvitationAction(): Promise<{
  success: boolean;
  dashboardPath?: string;
  alreadyActive?: boolean;
  error?: string;
}> {
  try {
    const user = await requireAuth();
    const { acceptInvitationForUser } = await import(
      '@/lib/services/staff-invitation-service'
    );
    const result = await acceptInvitationForUser(user.id);
    return {
      success: true,
      dashboardPath: result.dashboardPath,
      alreadyActive: result.alreadyActive,
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'digest' in error &&
      String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    if (error instanceof DomainError) {
      return { success: false, error: error.message };
    }
    return {
      success: false,
      error: 'Failed to accept the invitation. Please try again.',
    };
  }
}

/**
 * Read-only context for the onboarding page: the caller's own
 * INVITED memberships (names only — no tokens, no secrets).
 */
export async function getAcceptInvitationContext(): Promise<{
  userId: string;
  email: string | null;
  invited: Array<{ restaurantName: string; role: string; invitedAt: string | null }>;
} | null> {
  try {
    const user = await requireAuth();
    const adminClient = createAdminClient();
    const { data } = await adminClient
      .from('restaurant_memberships')
      .select('role, invited_at, restaurants(name)')
      .eq('user_id', user.id)
      .eq('status', 'INVITED');
    const invited = ((data ?? []) as unknown as Array<{
      role: string;
      invited_at: string | null;
      restaurants: { name: string } | Array<{ name: string }> | null;
    }>).map((m) => {
      const rest = Array.isArray(m.restaurants) ? m.restaurants[0] : m.restaurants;
      return {
        restaurantName: rest?.name ?? 'your restaurant',
        role: m.role,
        invitedAt: m.invited_at,
      };
    });
    return { userId: user.id, email: user.email ?? null, invited };
  } catch {
    return null;
  }
}

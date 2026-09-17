'use server';

import { createServerClient } from '@/lib/db/supabase/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export async function loginAction(_prevState: unknown, formData: FormData) {
  // Phase 3E: brute-force/credential-stuffing protection at the action layer
  // (complements Supabase Auth's own throttling). Generous limit so shared
  // restaurant networks are never locked out by normal use.
  try {
    const { checkRateLimit, RateLimitEndpointClass, getActionClientIp } =
      await import('@/lib/rate-limit');
    const loginLimit = await checkRateLimit({
      identifier: `rl:auth:login:${await getActionClientIp()}`,
      limit: 20,
      windowSeconds: 60,
      endpointClass: RateLimitEndpointClass.HIGH_COST,
    });
    if (!loginLimit.allowed) {
      return {
        success: false,
        error: 'Too many login attempts. Please wait a moment and try again.',
      };
    }
  } catch {
    // Rate-limiter failure must never lock everyone out; continue to Auth.
  }

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const parseResult = loginSchema.safeParse({ email, password });
  if (!parseResult.success) {
    return {
      success: false,
      error: 'Please enter a valid email and password.',
    };
  }

  const supabase = await createServerClient();

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return {
      success: false,
      error: 'Invalid credentials. Please check your email and password.',
    };
  }

  const userId = authData.user.id;

  // 1. Check Super Admin Role
  const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', {
    p_user_id: userId,
  });

  if (isSuperAdmin) {
    redirect('/platform');
  }

  // 2. Query Restaurant Memberships for RESTAURANT_ADMIN or STAFF
  const { data: memberships } = await supabase
    .from('restaurant_memberships')
    .select('role, status, restaurant_id')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');

  const adminMembership = memberships?.find((m) => m.role === 'RESTAURANT_ADMIN');
  if (adminMembership) {
    // Phase 3E: suspended/archived restaurants cannot operate.
    const { RestaurantAdminService } = await import('@/lib/services/restaurant-admin-service');
    try {
      await RestaurantAdminService.assertRestaurantActive(adminMembership.restaurant_id);
    } catch {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'This restaurant is not currently active. Please contact support.',
      };
    }
    redirect('/dashboard');
  }

  const staffMembership = memberships?.find((m) => m.role === 'STAFF');
  if (staffMembership) {
    // Phase 3E: suspended/archived restaurants cannot operate.
    const { RestaurantAdminService } = await import('@/lib/services/restaurant-admin-service');
    try {
      await RestaurantAdminService.assertRestaurantActive(staffMembership.restaurant_id);
    } catch {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'This restaurant is not currently active. Please contact support.',
      };
    }
    redirect('/dashboard/operational');
  }

  // No active authorized role found
  await supabase.auth.signOut();
  return {
    success: false,
    error: 'No active role assignment found for this account.',
  };
}

export async function signOutAction() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

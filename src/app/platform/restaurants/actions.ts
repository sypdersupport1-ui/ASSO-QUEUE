'use server';

import { PlatformService } from '@/lib/services/platform-service';
import type { RestaurantStatus } from '@/types/database.types';
import { redirect } from 'next/navigation';

export async function createRestaurantAction(_prevState: unknown, formData: FormData) {
  try {
    const input = {
      name: formData.get('name') as string,
      slug: formData.get('slug') as string,
      description: (formData.get('description') as string) || undefined,
      phone: (formData.get('phone') as string) || undefined,
      email: (formData.get('email') as string) || undefined,
      address: (formData.get('address') as string) || undefined,
      city: (formData.get('city') as string) || undefined,
      state: (formData.get('state') as string) || undefined,
      country: (formData.get('country') as string) || undefined,
      timezone: (formData.get('timezone') as string) || 'UTC',
      currency: (formData.get('currency') as string) || 'USD',
    };

    const newRestaurant = await PlatformService.createRestaurant(input);
    redirect(`/platform/restaurants/${newRestaurant.id}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create restaurant.',
    };
  }
}

export async function updateRestaurantAction(restaurantId: string, _prevState: unknown, formData: FormData) {
  try {
    const input = {
      name: formData.get('name') as string,
      slug: formData.get('slug') as string,
      description: (formData.get('description') as string) || undefined,
      phone: (formData.get('phone') as string) || undefined,
      email: (formData.get('email') as string) || undefined,
      address: (formData.get('address') as string) || undefined,
      city: (formData.get('city') as string) || undefined,
      state: (formData.get('state') as string) || undefined,
      country: (formData.get('country') as string) || undefined,
      timezone: (formData.get('timezone') as string) || undefined,
      currency: (formData.get('currency') as string) || undefined,
      dine_in_customer_ordering_enabled: formData.has('dine_in_customer_ordering_enabled') ? formData.get('dine_in_customer_ordering_enabled') === 'true' : undefined,
      dine_in_staff_ordering_enabled: formData.has('dine_in_staff_ordering_enabled') ? formData.get('dine_in_staff_ordering_enabled') === 'true' : undefined,
      takeaway_customer_ordering_enabled: formData.has('takeaway_customer_ordering_enabled') ? formData.get('takeaway_customer_ordering_enabled') === 'true' : undefined,
      takeaway_staff_ordering_enabled: formData.has('takeaway_staff_ordering_enabled') ? formData.get('takeaway_staff_ordering_enabled') === 'true' : undefined,
      takeaway_manual_ordering_enabled: formData.has('takeaway_manual_ordering_enabled') ? formData.get('takeaway_manual_ordering_enabled') === 'true' : undefined,
    };

    await PlatformService.updateRestaurant(restaurantId, input);
    redirect(`/platform/restaurants/${restaurantId}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update restaurant.',
    };
  }
}

export async function updateStatusAction(restaurantId: string, newStatus: RestaurantStatus) {
  try {
    await PlatformService.updateRestaurantStatus(restaurantId, newStatus);
    redirect(`/platform/restaurants/${restaurantId}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to transition restaurant status.',
    };
  }
}

export async function assignAdminAction(restaurantId: string, _prevState: unknown, formData: FormData) {
  try {
    const email = formData.get('email') as string;
    const displayName = formData.get('displayName') as string;
    const password = formData.get('password') as string;

    await PlatformService.assignRestaurantAdmin({
      restaurantId,
      email,
      displayName,
      password: password || undefined,
    });

    redirect(`/platform/restaurants/${restaurantId}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to assign restaurant admin.',
    };
  }
}

export async function deleteRestaurantAction(restaurantId: string, _prevState: unknown, formData: FormData) {
  try {
    const confirmSlug = formData.get('confirmSlug') as string;
    await PlatformService.deleteRestaurant(restaurantId, confirmSlug);
    redirect('/platform/restaurants');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete restaurant.',
    };
  }
}

/**
 * Seamless one-shot onboarding: restaurant + admin login (with password) +
 * optional staff logins (with passwords). The staff payload arrives as a JSON
 * array in the `staffJson` field: [{ email, displayName, password, role }].
 */
export async function createRestaurantWithTeamAction(_prevState: unknown, formData: FormData) {
  try {
    const get = (k: string) => ((formData.get(k) as string) || '').trim();
    let staff: Array<{ email: string; displayName: string; password: string; role: 'STAFF' | 'RESTAURANT_ADMIN' }> = [];
    try {
      const raw = formData.get('staffJson');
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) staff = parsed;
      }
    } catch {
      return { success: false, error: 'Staff list is malformed. Please re-add staff rows.' };
    }

    const adminEmail = get('adminEmail');
    const result = await PlatformService.createRestaurantWithTeam({
      restaurant: {
        name: get('name'),
        slug: get('slug'),
        description: get('description') || undefined,
        phone: get('phone') || undefined,
        email: get('email') || undefined,
        address: get('address') || undefined,
        city: get('city') || undefined,
        state: get('state') || undefined,
        country: get('country') || undefined,
        timezone: get('timezone') || 'UTC',
        currency: get('currency') || 'USD',
      },
      admin: adminEmail
        ? {
            email: adminEmail,
            displayName: get('adminName') || adminEmail.split('@')[0] || adminEmail,
            password: (formData.get('adminPassword') as string) || '',
          }
        : undefined,
      staff,
    });
    redirect(`/platform/restaurants/${result.restaurant.id}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create restaurant.',
    };
  }
}

export async function createTeamMemberAction(restaurantId: string, _prevState: unknown, formData: FormData) {
  try {
    await PlatformService.createTeamMemberDirect({
      restaurantId,
      email: (formData.get('email') as string) || '',
      displayName: (formData.get('displayName') as string) || '',
      password: (formData.get('password') as string) || '',
      role: ((formData.get('role') as string) === 'RESTAURANT_ADMIN' ? 'RESTAURANT_ADMIN' : 'STAFF'),
    });
    redirect(`/platform/restaurants/${restaurantId}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'digest' in error && String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add team member.',
    };
  }
}

export async function removeTeamMemberAction(restaurantId: string, targetUserId: string) {
  await PlatformService.removeTeamMember(restaurantId, targetUserId);
  redirect(`/platform/restaurants/${restaurantId}`);
}

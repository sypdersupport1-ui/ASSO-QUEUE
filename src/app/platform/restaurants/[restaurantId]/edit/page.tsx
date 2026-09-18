import React from 'react';
import { PlatformService } from '@/lib/services/platform-service';
import EditRestaurantForm from './EditRestaurantForm';

export const dynamic = 'force-dynamic';

export default async function EditRestaurantPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const restaurant = await PlatformService.getRestaurantById(restaurantId);

  return (
    <EditRestaurantForm
      restaurantId={restaurantId}
      initial={{
        name: restaurant.name || '',
        slug: restaurant.slug || '',
        description: restaurant.description || '',
        phone: restaurant.phone || '',
        email: restaurant.email || '',
        address: restaurant.address || '',
        city: restaurant.city || '',
        state: restaurant.state || '',
        country: restaurant.country || '',
        timezone: restaurant.timezone || 'UTC',
        currency: restaurant.currency || 'USD',
        dine_in_customer_ordering_enabled: (restaurant as unknown as { dine_in_customer_ordering_enabled?: boolean }).dine_in_customer_ordering_enabled ?? true,
        dine_in_staff_ordering_enabled: (restaurant as unknown as { dine_in_staff_ordering_enabled?: boolean }).dine_in_staff_ordering_enabled ?? true,
        takeaway_customer_ordering_enabled: (restaurant as unknown as { takeaway_customer_ordering_enabled?: boolean }).takeaway_customer_ordering_enabled ?? true,
        takeaway_staff_ordering_enabled: (restaurant as unknown as { takeaway_staff_ordering_enabled?: boolean }).takeaway_staff_ordering_enabled ?? true,
      }}
    />
  );
}

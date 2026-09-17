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
      }}
    />
  );
}

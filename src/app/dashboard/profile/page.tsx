import React from 'react';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import RestaurantProfileClient from './RestaurantProfileClient';

export default async function RestaurantProfilePage() {
  const { restaurant } = await RestaurantAdminService.getRestaurantDashboardStats();
  
  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">
      <RestaurantProfileClient
        restaurant={{
          name: restaurant.name,
          description: restaurant.description,
          phone: restaurant.phone,
          email: restaurant.email,
          address: restaurant.address,
          city: restaurant.city,
          state: restaurant.state,
          country: restaurant.country,
          timezone: restaurant.timezone,
          currency: restaurant.currency,
          seating_mode: (restaurant.seating_mode || 'SIMPLE') as 'SIMPLE' | 'STRICT',
          takeaway_enabled: Boolean(restaurant.takeaway_enabled),
        }}
      />
    </div>
  );
}

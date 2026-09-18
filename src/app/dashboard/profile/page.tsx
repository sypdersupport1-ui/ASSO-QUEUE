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
          dine_in_customer_ordering_enabled: (restaurant as unknown as { dine_in_customer_ordering_enabled?: boolean }).dine_in_customer_ordering_enabled ?? true,
          dine_in_staff_ordering_enabled: (restaurant as unknown as { dine_in_staff_ordering_enabled?: boolean }).dine_in_staff_ordering_enabled ?? true,
          takeaway_customer_ordering_enabled: (restaurant as unknown as { takeaway_customer_ordering_enabled?: boolean }).takeaway_customer_ordering_enabled ?? true,
          takeaway_staff_ordering_enabled: (restaurant as unknown as { takeaway_staff_ordering_enabled?: boolean }).takeaway_staff_ordering_enabled ?? true,
        }}
      />
    </div>
  );
}

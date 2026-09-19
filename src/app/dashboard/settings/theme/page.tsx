import React from 'react';
import type { Metadata } from 'next';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { getRegisteredThemes } from '@/lib/themes/registry';
import ThemeLibraryClient from './ThemeLibraryClient';

export const metadata: Metadata = {
  title: 'Customer Experience & Themes | QueueFlow Command OS',
  description: 'Manage the customer-facing occasion and festival themes for your restaurant QR experience.',
};

export default async function ThemeSettingsPage() {
  const { restaurant } = await RestaurantAdminService.getRestaurantDashboardStats();
  const themes = getRegisteredThemes();
  const schedules = await RestaurantAdminService.listCustomerThemeSchedules();

  return (
    <ThemeLibraryClient
      restaurantName={restaurant.name}
      restaurantTimezone={restaurant.timezone || 'UTC'}
      initialThemeKey={restaurant.customer_theme_key || 'default'}
      initialSchedules={schedules}
      themes={themes}
    />
  );
}

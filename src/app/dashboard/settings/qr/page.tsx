import React from 'react';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { QRManagerClient } from '@/components/dashboard/QRManagerClient';

export default async function RestaurantQRPage() {
  const { restaurant } = await RestaurantAdminService.getRestaurantDashboardStats();
  
  // Use APPLICATION_URL, NEXT_PUBLIC_APP_URL, or VERCEL_PROJECT_PRODUCTION_URL (canonical production domain)
  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const baseUrl =
    process.env.APPLICATION_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (vercelDomain ? `https://${vercelDomain}` : 'http://localhost:3000');
  const qrUrl = `${baseUrl.replace(/\/$/, '')}/q/${restaurant.slug}`;

  return (
    <QRManagerClient 
      restaurantName={restaurant.name} 
      qrUrl={qrUrl} 
    />
  );
}

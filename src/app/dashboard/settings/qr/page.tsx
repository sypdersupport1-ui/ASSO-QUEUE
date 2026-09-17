import React from 'react';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { QRManagerClient } from '@/components/dashboard/QRManagerClient';

export default async function RestaurantQRPage() {
  const { restaurant } = await RestaurantAdminService.getRestaurantDashboardStats();
  
  // Use APPLICATION_URL (server-only, already validated) for correct QR link
  const baseUrl = process.env.APPLICATION_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const qrUrl = `${baseUrl.replace(/\/$/, '')}/q/${restaurant.slug}`;

  return (
    <QRManagerClient 
      restaurantName={restaurant.name} 
      qrUrl={qrUrl} 
    />
  );
}

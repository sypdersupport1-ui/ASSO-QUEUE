'use client';

import { useOrderRealtime, useNotificationRealtime } from '@/lib/realtime/hooks';

/**
 * Phase 5A — home-screen realtime coverage for orders + staff alerts.
 * The layout already mounts DashboardRealtime (queue + tables + operating
 * state + schedule). This adds the two remaining home domains using the
 * SAME narrow-channel hook (event → authoritative router.refresh, 60s
 * fallback). No new realtime architecture, no payload trust.
 */
export function DashboardHomeRealtime({ restaurantId }: { restaurantId: string }) {
  useOrderRealtime(restaurantId, !!restaurantId);
  useNotificationRealtime(restaurantId, !!restaurantId);
  return null;
}

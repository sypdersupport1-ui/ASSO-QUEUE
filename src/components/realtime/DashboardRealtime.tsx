'use client';

import { useDashboardRealtime, useTableRealtime, useRestaurantRealtime, useQueueScheduleRealtime } from '@/lib/realtime/hooks';
import { RealtimeIndicator } from './RealtimeIndicator';

export function DashboardRealtime({ restaurantId }: { restaurantId: string }) {
  const { connectionState } = useDashboardRealtime(restaurantId);
  // Also subscribe to tables, restaurant operating state, and schedule for dashboard metrics
  useTableRealtime(restaurantId);
  useRestaurantRealtime(restaurantId);
  useQueueScheduleRealtime(restaurantId);
  return <RealtimeIndicator state={connectionState} compact />;
}

export function DashboardRealtimeSilent({ restaurantId }: { restaurantId: string }) {
  useDashboardRealtime(restaurantId);
  useTableRealtime(restaurantId);
  useRestaurantRealtime(restaurantId);
  useQueueScheduleRealtime(restaurantId);
  return null;
}

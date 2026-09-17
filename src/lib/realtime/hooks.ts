'use client';

import { useRealtimeChannel } from './useRealtimeConnection';

export function useStaffQueueRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:queue`,
    table: 'queue_entries',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

export function useTableRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:tables`,
    table: 'restaurant_tables',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

export function useOrderRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:orders`,
    table: 'orders',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

export function useDashboardRealtime(restaurantId: string, enabled = true) {
  // Dashboard needs queue + tables: we subscribe to queue, tables will be covered by separate hook or combined
  // For simplicity, dashboard subscribes to queue_entries and triggers re-fetch which includes tables via layout
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:dashboard`,
    table: 'queue_entries',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

export function useKitchenRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:kitchen`,
    table: 'orders',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 30000,
  });
}

export function useNotificationRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:notifications`,
    table: 'notifications',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

export function useRestaurantRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:restaurant`,
    table: 'restaurants',
    filter: `id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

export function useQueueScheduleRealtime(restaurantId: string, enabled = true) {
  return useRealtimeChannel({
    channelName: `restaurant:${restaurantId}:schedule`,
    table: 'restaurant_queue_hours',
    filter: `restaurant_id=eq.${restaurantId}`,
    restaurantId,
    enabled: !!restaurantId && enabled,
    fallbackIntervalMs: 60000,
  });
}

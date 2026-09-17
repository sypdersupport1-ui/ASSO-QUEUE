'use client';

import { useOrderRealtime, useKitchenRealtime } from '@/lib/realtime/hooks';

export function OrderRealtime({ restaurantId }: { restaurantId: string }) {
  useOrderRealtime(restaurantId);
  return null;
}

export function KitchenRealtime({ restaurantId }: { restaurantId: string }) {
  useKitchenRealtime(restaurantId);
  return null;
}

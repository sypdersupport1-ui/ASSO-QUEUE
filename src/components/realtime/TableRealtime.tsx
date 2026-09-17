'use client';

import { useTableRealtime } from '@/lib/realtime/hooks';

export function TableRealtime({ restaurantId }: { restaurantId: string }) {
  useTableRealtime(restaurantId);
  return null;
}

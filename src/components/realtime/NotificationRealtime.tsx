'use client';

import { useNotificationRealtime } from '@/lib/realtime/hooks';

export function NotificationRealtime({ restaurantId }: { restaurantId: string }) {
  useNotificationRealtime(restaurantId);
  return null;
}

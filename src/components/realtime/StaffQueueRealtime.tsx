'use client';

import { useStaffQueueRealtime } from '@/lib/realtime/hooks';
import { RealtimeIndicator } from './RealtimeIndicator';

export function StaffQueueRealtime({ restaurantId }: { restaurantId: string }) {
  const { connectionState } = useStaffQueueRealtime(restaurantId);
  return (
    <div className="flex items-center gap-2">
      <RealtimeIndicator state={connectionState} />
    </div>
  );
}

export function StaffQueueRealtimeSilent({ restaurantId }: { restaurantId: string }) {
  useStaffQueueRealtime(restaurantId);
  return null;
}

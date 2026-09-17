import React from 'react';
import { TableService } from '@/lib/services/table-service';
import { ZoneService } from '@/lib/services/zone-service';
import { QueueService } from '@/lib/services/queue-service';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { FloorManagerClient } from '@/components/dashboard/FloorManagerClient';

export default async function TablesPage() {
  const { restaurantId, userId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
  const supabase = createAdminClient();
  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('id', restaurantId).single();

  if (!restaurant) {
    return <div className="p-space-xl text-error">No managed restaurant assigned.</div>;
  }

  // Fetch all necessary data concurrently
  const [
    { tables, stats },
    { zones },
    queueEntries,
    seatedEntries,
  ] = await Promise.all([
    TableService.listTables({ limit: 200, restaurantId: restaurant.id }),
    ZoneService.listZones({ status: 'ACTIVE' }),
    QueueService.getActiveQueue(restaurant.id),
    QueueService.getSeatedQueueEntries(restaurant.id),
  ]);

  return (
    <FloorManagerClient
      tables={tables}
      zones={zones}
      stats={stats}
      restaurantName={restaurant.name}
      queueEntries={queueEntries}
      seatedEntries={seatedEntries}
      userId={userId}
      seatingMode={(restaurant.seating_mode || 'SIMPLE') as 'SIMPLE' | 'STRICT'}
    />
  );
}

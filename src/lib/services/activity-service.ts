import 'server-only';

import { createAdminClient } from '@/lib/db/supabase/admin';

export interface DashboardActivityItem {
  id: string;
  type: 'QUEUE' | 'ORDER' | 'TABLE' | 'ALERT' | 'SYSTEM';
  title: string;
  message: string;
  time: string;
  badge?: string | null;
  severity: 'info' | 'success' | 'warning' | 'error';
  icon: string;
  href?: string;
}

export class ActivityService {
  /**
   * Aggregates real-time chronological restaurant events for staff notification center.
   */
  static async getRestaurantActivityFeed(
    restaurantId: string,
    limit = 40
  ): Promise<DashboardActivityItem[]> {
    const supabase = createAdminClient();
    const feed: DashboardActivityItem[] = [];

    // 1. Fetch queue events
    try {
      const { data: queueEvents } = await supabase
        .from('queue_events')
        .select(`
          id,
          event_type,
          created_at,
          metadata,
          queue_entries (
            display_number,
            customer_name,
            party_size,
            queue_type
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(25);

      if (queueEvents) {
        for (const ev of queueEvents) {
          const q = ev.queue_entries as unknown as {
            display_number?: string | null;
            customer_name?: string | null;
            party_size?: number | null;
            queue_type?: string | null;
          } | null;

          const meta = (ev.metadata || {}) as Record<string, unknown>;
          const customerName = q?.customer_name || (meta.customerName as string) || 'Guest';
          const displayNumber = q?.display_number || (meta.displayNumber as string) || '';
          const partySize = q?.party_size || (meta.partySize as number) || '';
          const badge = displayNumber ? `Q-${displayNumber}` : null;

          let title = 'Queue Update';
          let message = `Activity on ticket ${displayNumber || ''}`;
          let severity: DashboardActivityItem['severity'] = 'info';
          let icon = 'groups';
          let href = '/dashboard/queue';

          switch (ev.event_type) {
            case 'QUEUE_JOINED':
            case 'JOINED':
              title = 'New Guest Joined Queue';
              message = `${customerName} (${partySize ? `${partySize} guests` : 'Party'}) joined the line.`;
              severity = 'info';
              icon = 'person_add';
              break;

            case 'QUEUE_CALLED':
            case 'CALLED':
              title = 'Guest Called to Host Stand';
              message = `${customerName} (${badge || 'Ticket'}) was called for seating.`;
              severity = 'warning';
              icon = 'campaign';
              break;

            case 'CALL_ACCEPTED':
            case 'CALL_RESPONSE_ACCEPTED':
              title = 'Guest Confirmed — On Their Way';
              message = `${customerName} responded: "I am here / on my way".`;
              severity = 'success';
              icon = 'directions_walk';
              break;

            case 'CALL_DELAY_REQUESTED':
            case 'CALL_DELAYED':
              title = 'Guest Requested Time Delay';
              message = `${customerName} requested extra buffer time before seating.`;
              severity = 'warning';
              icon = 'hourglass_top';
              break;

            case 'QUEUE_SEATED':
            case 'SEATED':
              title = 'Party Seated';
              message = `${customerName} (${partySize ? `${partySize} guests` : 'Party'}) was seated.`;
              severity = 'success';
              icon = 'chair';
              href = '/dashboard/tables';
              break;

            case 'QUEUE_CANCELLED':
            case 'CANCELLED':
              title = 'Queue Ticket Cancelled';
              message = `${customerName} left the queue.`;
              severity = 'error';
              icon = 'person_remove';
              break;

            case 'QUEUE_NO_SHOW':
            case 'NO_SHOW':
              title = 'No-Show Released';
              message = `${customerName} missed the call window.`;
              severity = 'error';
              icon = 'event_busy';
              break;

            case 'QUEUE_NOTIFIED':
              title = 'Almost Your Turn Buzz Sent';
              message = `Notified ${customerName} to head toward the host stand.`;
              severity = 'info';
              icon = 'notifications';
              break;

            default:
              title = `Queue: ${ev.event_type.replace(/_/g, ' ')}`;
              message = `${customerName} status updated to ${ev.event_type}.`;
              break;
          }

          feed.push({
            id: `q-ev-${ev.id}`,
            type: 'QUEUE',
            title,
            message,
            time: ev.created_at,
            badge,
            severity,
            icon,
            href,
          });
        }
      }
    } catch {
      // Graceful fallback
    }

    // 2. Fetch order events
    try {
      const { data: orderEvents } = await supabase
        .from('order_events')
        .select(`
          id,
          event_type,
          created_at,
          metadata,
          orders (
            order_number,
            customer_name,
            total,
            status
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(25);

      if (orderEvents) {
        for (const ev of orderEvents) {
          const ord = ev.orders as unknown as {
            order_number?: string | null;
            customer_name?: string | null;
            total?: number | null;
            status?: string | null;
          } | null;

          const meta = (ev.metadata || {}) as Record<string, unknown>;
          const orderNum = ord?.order_number || (meta.orderNumber as string) || '';
          const customerName = ord?.customer_name || (meta.customerName as string) || 'Customer';
          const totalVal = ord?.total ?? (meta.total as number) ?? null;
          const badge = orderNum ? `#${orderNum}` : null;

          let title = 'Order Update';
          let message = `Order ${badge || ''} updated.`;
          let severity: DashboardActivityItem['severity'] = 'info';
          let icon = 'receipt_long';
          let href = '/dashboard/orders';

          switch (ev.event_type) {
            case 'ORDER_PLACED':
            case 'PLACED':
              title = 'New Order Received';
              message = `Order from ${customerName}${totalVal !== null ? ` ($${Number(totalVal).toFixed(2)})` : ''}.`;
              severity = 'info';
              icon = 'shopping_cart';
              break;

            case 'ORDER_CONFIRMED':
            case 'CONFIRMED':
              title = 'Order Confirmed';
              message = `Order ${badge} confirmed & queued for kitchen.`;
              severity = 'info';
              icon = 'check_circle';
              href = '/dashboard/kitchen';
              break;

            case 'ORDER_PREPARING':
            case 'PREPARING':
              title = 'Kitchen Cooking Started';
              message = `Kitchen is actively preparing ${badge} for ${customerName}.`;
              severity = 'warning';
              icon = 'skillet';
              href = '/dashboard/kitchen';
              break;

            case 'ORDER_READY':
            case 'READY':
              title = 'Order Plated & Ready for Service';
              message = `${badge} for ${customerName} is ready for dispatch!`;
              severity = 'success';
              icon = 'notifications_active';
              href = '/dashboard/kitchen';
              break;

            case 'ORDER_SERVED':
            case 'SERVED':
              title = 'Order Served & Completed';
              message = `${badge} delivered to ${customerName}.`;
              severity = 'success';
              icon = 'task_alt';
              break;

            case 'ORDER_CANCELLED':
            case 'CANCELLED':
              title = 'Order Cancelled';
              message = `${badge} was cancelled.`;
              severity = 'error';
              icon = 'cancel';
              break;

            default:
              title = `Order: ${ev.event_type.replace(/_/g, ' ')}`;
              message = `${badge || 'Order'} status changed to ${ev.event_type}.`;
              break;
          }

          feed.push({
            id: `ord-ev-${ev.id}`,
            type: 'ORDER',
            title,
            message,
            time: ev.created_at,
            badge,
            severity,
            icon,
            href,
          });
        }
      }
    } catch {
      // Graceful fallback
    }

    // 3. Fetch in-app notifications
    try {
      const { data: notifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (notifs) {
        for (const n of notifs) {
          feed.push({
            id: `notif-${n.id}`,
            type: 'ALERT',
            title: n.title || 'System Notification',
            message: n.message || '',
            time: n.created_at,
            badge: n.notification_type ? n.notification_type.replace(/_/g, ' ') : null,
            severity: n.notification_type?.includes('CALL') ? 'warning' : 'info',
            icon: 'notifications',
            href: '/dashboard/queue',
          });
        }
      }
    } catch {
      // Graceful fallback
    }

    // Sort combined feed descending by time
    feed.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return feed.slice(0, limit);
  }
}

import { createAdminClient } from '@/lib/db/supabase/admin';
import { NotificationProviderFactory } from '../notifications/notification-provider-factory';
import { NotificationType, SendNotificationPayload } from '../notifications/types';

export interface OutboxEventRecord {
  id: string;
  restaurant_id: string;
  event_type: string;
  aggregate_type: 'QUEUE' | 'ORDER' | 'PAYMENT' | 'STAFF' | 'SYSTEM';
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
}

export class NotificationService {
  /**
   * Processes a single outbox event into notification dispatches.
   */
  static async processOutboxEvent(event: OutboxEventRecord): Promise<void> {
    const payload = event.payload || {};
    const restaurantId = event.restaurant_id;

    // Generate human-friendly notification messages based on event type
    const notificationsToDispatch: SendNotificationPayload[] = [];

    switch (event.event_type) {
      case 'QUEUE_JOINED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_JOINED',
          title: 'You’re in line!',
          message: `Ticket ${payload.displayNumber || '#' + event.aggregate_id.slice(0,4)} confirmed for ${payload.customerName || 'you'} (${payload.partySize || ''} guests). We’ll buzz you when it’s almost your turn.`,
          metadata: payload,
        });
        break;

      case 'QUEUE_NOTIFIED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_ALMOST_TURN',
          title: "Almost your turn!",
          message: `Hi ${payload.customerName || ''}, you’re almost up! Ticket ${payload.displayNumber || ''} — please stay nearby and head toward the host stand.`,
          metadata: payload,
        });
        break;

      case 'QUEUE_CALLED': {
        const isTakeaway = payload.queueType === 'TAKEAWAY' || payload.queue_type === 'TAKEAWAY' || (payload.displayNumber && String(payload.displayNumber).startsWith('T-'));
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_CALLED',
          title: isTakeaway ? "Your takeaway order is ready!" : "Your table is ready!",
          message: isTakeaway
            ? `Ticket ${payload.displayNumber || ''} — your takeaway order is ready for pickup. Please proceed to the takeaway counter.`
            : `Ticket ${payload.displayNumber || ''} — ${payload.customerName || 'your table'} is ready. Please come to the host stand now.`,
          metadata: payload,
        });
        break;
      }

      case 'TAKEAWAY_COMPLETED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'ORDER_SERVED',
          title: "Order collected!",
          message: `Ticket ${payload.displayNumber || ''} — your takeaway order has been completed. Enjoy!`,
          metadata: payload,
        });
        break;

      case 'QUEUE_CANCELLED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_CANCELLED',
          title: "Queue cancelled",
          message: `Ticket ${payload.displayNumber || ''} was cancelled. You can re-join anytime from the QR.`,
          metadata: payload,
        });
        break;

      case 'QUEUE_NO_SHOW':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_NO_SHOW',
          title: "Marked as no-show",
          message: `We missed you for ticket ${payload.displayNumber || ''}. If you’re still nearby, please check with the host to re-join.`,
          metadata: payload,
        });
        break;

      case 'QUEUE_SEATED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_SEATED',
          title: "You’re seated!",
          message: `Ticket ${payload.displayNumber || ''} — enjoy your meal!`,
          metadata: payload,
        });
        break;

      case 'QUEUE_EXPIRED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_EXPIRED',
          title: "Queue expired",
          message: `Ticket ${payload.displayNumber || ''} expired. Please scan the QR to join again.`,
          metadata: payload,
        });
        break;

      case 'QUEUE_POSITION_UPDATED':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_POSITION_UPDATED',
          title: 'Queue update',
          message: `You are now #${payload.position} in line (${payload.peopleAhead} ahead).`,
          metadata: payload,
        });
        break;

      case 'QUEUE_ALMOST_TURN':
        notificationsToDispatch.push({
          restaurantId,
          queueEntryId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'QUEUE_ALMOST_TURN',
          title: "You’re getting close!",
          message: `You are #${payload.position} in line! Please head towards the restaurant.`,
          metadata: payload,
        });
        break;

      case 'ORDER_PLACED':
        notificationsToDispatch.push({
          restaurantId,
          orderId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'ORDER_PLACED',
          title: 'Order Received',
          message: `Order #${payload.orderNumber || event.aggregate_id.slice(0, 6)} has been placed.`,
          metadata: payload,
        });
        break;

      case 'ORDER_READY':
        notificationsToDispatch.push({
          restaurantId,
          orderId: event.aggregate_id,
          channel: 'IN_APP',
          notificationType: 'ORDER_READY',
          title: 'Food Ready!',
          message: `Order #${payload.orderNumber || event.aggregate_id.slice(0, 6)} is cooked and ready to be served!`,
          metadata: payload,
        });
        break;

      case 'PAYMENT_SUCCEEDED':
        notificationsToDispatch.push({
          restaurantId,
          orderId: (payload.order_id as string) || undefined,
          channel: 'IN_APP',
          notificationType: 'PAYMENT_SUCCEEDED',
          title: 'Payment Successful',
          message: `Payment of ₹${payload.amount} was confirmed. Thank you!`,
          metadata: payload,
        });
        break;

      default:
        // Generic fallback
        notificationsToDispatch.push({
          restaurantId,
          channel: 'IN_APP',
          notificationType: (event.event_type as NotificationType) || 'QUEUE_POSITION_UPDATED',
          title: (payload.title as string) || event.event_type,
          message: `Notification update for ${event.aggregate_type} #${event.aggregate_id.slice(0, 6)}`,
          metadata: payload,
        });
        break;
    }

    // Dispatch through appropriate channel providers
    // Idempotency: bind each notification to its source outbox event so a
    // duplicate encounter (crash between send and markCompleted) does not
    // create a second internal notification row. Providers enforce the
    // unique idempotency_key constraint and treat conflicts as success.
    for (const notifPayload of notificationsToDispatch) {
      if (!notifPayload.idempotencyKey) {
        notifPayload.idempotencyKey = event.id;
      }
      const provider = NotificationProviderFactory.getProvider(notifPayload.channel);
      const result = await provider.send(notifPayload);

      if (!result.success) {
        throw new Error(`Notification dispatch failed for channel ${notifPayload.channel}: ${result.errorMessage}`);
      }
    }
  }

  /**
   * Fetches customer in-app notifications authorized via queue_entry_id.
   */
  static async getCustomerNotificationsByQueueId(queueEntryId: string, restaurantId: string) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('queue_entry_id', queueEntryId)
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw new Error(`Failed to fetch customer notifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Fetches staff in-app notifications for restaurant dashboard.
   */
  static async getStaffNotifications(restaurantId: string, limit = 20) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch staff notifications: ${error.message}`);
    }

    return data || [];
  }
}

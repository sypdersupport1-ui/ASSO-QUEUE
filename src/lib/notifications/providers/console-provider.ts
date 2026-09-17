import { createAdminClient } from '@/lib/db/supabase/admin';
import { NotificationProvider } from './notification-provider.interface';
import { SendNotificationPayload, NotificationResult } from '../types';
import { NotificationChannel } from '@/types/database.types';

export class ConsoleNotificationProvider implements NotificationProvider {
  readonly channelName: NotificationChannel;

  constructor(channelName: NotificationChannel = 'SMS') {
    this.channelName = channelName;
  }

  async send(payload: SendNotificationPayload): Promise<NotificationResult> {
    const supabase = createAdminClient();

    if (payload.idempotencyKey) {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id, provider_message_id')
        .eq('idempotency_key', payload.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return {
          success: true,
          notificationId: existing.id,
          providerMessageId: existing.provider_message_id || undefined,
          status: 'SENT',
        };
      }
    }

    const providerMsgId = `mock_${this.channelName.toLowerCase()}_${Date.now()}`;

    // Phase 3E: recipient + message body are PII — stdout logging is
    // development-only. Production keeps the persisted record only.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[NOTIFICATION DISPATCH] Channel: ${this.channelName} | Type: ${payload.notificationType} | Recipient: ${payload.recipient || 'N/A'} | Message: "${payload.message}"`);
    }

    const { data: record, error } = await supabase
      .from('notifications')
      .insert({
        restaurant_id: payload.restaurantId,
        queue_entry_id: payload.queueEntryId || null,
        order_id: payload.orderId || null,
        channel: this.channelName,
        notification_type: payload.notificationType,
        recipient: payload.recipient || 'console',
        status: 'SENT',
        provider: `MOCK_${this.channelName}`,
        provider_message_id: providerMsgId,
        idempotency_key: payload.idempotencyKey || null,
        message: payload.message,
        metadata: payload.metadata || {},
      })
      .select()
      .single();

    if (error || !record) {
      if (error && (error.code === '23505' || error.message.includes('unique_notifications_idempotency'))) {
        const { data: existing } = await supabase
          .from('notifications')
          .select('id, provider_message_id')
          .eq('idempotency_key', payload.idempotencyKey || '')
          .maybeSingle();
        if (existing) {
          return {
            success: true,
            notificationId: existing.id,
            providerMessageId: existing.provider_message_id || undefined,
            status: 'SENT',
          };
        }
      }
      return {
        success: false,
        status: 'FAILED',
        errorMessage: error?.message || 'Failed to persist notification record',
      };
    }

    return {
      success: true,
      notificationId: record.id,
      providerMessageId: providerMsgId,
      status: 'SENT',
    };
  }
}

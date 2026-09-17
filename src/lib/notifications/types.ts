import { NotificationChannel, NotificationStatus } from '@/types/database.types';

export type NotificationType =
  // Queue Types
  | 'QUEUE_JOINED'
  | 'QUEUE_POSITION_UPDATED'
  | 'QUEUE_ALMOST_TURN'
  | 'QUEUE_NOTIFIED'
  | 'QUEUE_CALLED'
  | 'QUEUE_SEATED'
  | 'QUEUE_CANCELLED'
  | 'QUEUE_NO_SHOW'
  | 'QUEUE_EXPIRED'
  // Order Types
  | 'ORDER_PLACED'
  | 'ORDER_CONFIRMED'
  | 'ORDER_PREPARING'
  | 'ORDER_READY'
  | 'ORDER_SERVED'
  | 'ORDER_CANCELLED'
  // Payment Types
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED';

export interface SendNotificationPayload {
  restaurantId: string;
  queueEntryId?: string;
  orderId?: string;
  channel: NotificationChannel;
  notificationType: NotificationType;
  recipient?: string;
  title?: string;
  message: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface NotificationResult {
  success: boolean;
  notificationId?: string;
  providerMessageId?: string;
  status: NotificationStatus;
  errorMessage?: string;
}

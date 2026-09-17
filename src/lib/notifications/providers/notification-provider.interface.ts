import { SendNotificationPayload, NotificationResult } from '../types';

export interface NotificationProvider {
  readonly channelName: string;

  /**
   * Dispatches a notification through the channel provider.
   */
  send(payload: SendNotificationPayload): Promise<NotificationResult>;
}

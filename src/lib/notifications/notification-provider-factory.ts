import { NotificationProvider } from './providers/notification-provider.interface';
import { InAppNotificationProvider } from './providers/in-app-provider';
import { ConsoleNotificationProvider } from './providers/console-provider';
import { NotificationChannel } from '@/types/database.types';

export class NotificationProviderFactory {
  private static providers: Map<NotificationChannel, NotificationProvider> = new Map();

  static getProvider(channel: NotificationChannel): NotificationProvider {
    if (this.providers.has(channel)) {
      return this.providers.get(channel)!;
    }

    let provider: NotificationProvider;
    switch (channel) {
      case 'IN_APP':
        provider = new InAppNotificationProvider();
        break;
      case 'SMS':
      case 'WHATSAPP':
      case 'EMAIL':
      case 'PUSH':
      default:
        provider = new ConsoleNotificationProvider(channel);
        break;
    }

    this.providers.set(channel, provider);
    return provider;
  }
}

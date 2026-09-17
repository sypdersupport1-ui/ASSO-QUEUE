import { PaymentProvider } from './providers/payment-provider.interface';
import { RazorpayProvider } from './providers/razorpay-provider';
import { ManualPaymentProvider } from './providers/manual-provider';
import { PaymentMethod } from '@/types/database.types';

export class PaymentProviderFactory {
  private static providers: Map<string, PaymentProvider> = new Map();

  static getProvider(method: PaymentMethod, providerName?: string): PaymentProvider {
    const key = (providerName || (method === 'ONLINE' ? 'RAZORPAY' : method)).toUpperCase();

    if (this.providers.has(key)) {
      return this.providers.get(key)!;
    }

    let provider: PaymentProvider;
    switch (key) {
      case 'RAZORPAY':
        provider = new RazorpayProvider();
        break;
      case 'CASH':
      case 'PAY_AT_RESTAURANT':
      case 'MANUAL':
        provider = new ManualPaymentProvider(key as 'CASH' | 'PAY_AT_RESTAURANT' | 'MANUAL');
        break;
      default:
        provider = new RazorpayProvider();
        break;
    }

    this.providers.set(key, provider);
    return provider;
  }
}

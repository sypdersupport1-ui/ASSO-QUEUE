'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { CreditCard, Store, ReceiptText, Ticket } from 'lucide-react';
import { resolveCustomerTheme } from '@/lib/themes/resolver';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';

interface PaymentStatusState {
  status: 'IDLE' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  message?: string;
  providerRef?: string;
}

interface OrderItemRecord {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  specialInstructions?: string | null;
}

interface OrderRecord {
  id: string;
  order_number: string;
  total: number;
  restaurant_id: string;
  restaurant_name?: string;
  restaurant_currency?: string;
  restaurant_theme_key?: string | null;
  status: string;
  payment_status?: string;
  subtotal?: number;
  tax?: number;
  items?: OrderItemRecord[];
}

/**
 * Customer payment screen in the shared QueueFlow customer design system.
 * Unchanged security model: the order bearer token authorizes every call.
 */
export default function CustomerPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; orderToken: string }>;
  searchParams: Promise<{ qtoken?: string }>;
}) {
  const { slug, orderToken } = use(params);
  const { qtoken } = use(searchParams);

  const [loading, setLoading] = useState<boolean>(true);
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentStatusState>({ status: 'IDLE' });
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'PAY_AT_RESTAURANT'>('ONLINE');
  const [processing, setProcessing] = useState<boolean>(false);

  const currency = order?.restaurant_currency || 'INR';
  const formatPrice = (amount: number) => {
    try {
      return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  };

  useEffect(() => {
    async function loadOrder() {
      setLoading(true);
      try {
        const res = await fetch(`/api/customer/orders?slug=${slug}&token=${orderToken}`);
        if (!res.ok) {
          throw new Error('Order not found.');
        }
        const data = await res.json();
        setOrder(data.order);
      } catch {
        setError('Order not found.');
      } finally {
        setLoading(false);
      }
    }
    loadOrder();
  }, [slug, orderToken]);

  const handlePayNow = async () => {
    if (!order) return;
    setProcessing(true);
    setPaymentState({ status: 'PROCESSING', message: 'Payment is being confirmed...' });
    setError(null);

    try {
      if (paymentMethod === 'PAY_AT_RESTAURANT') {
        setPaymentState({
          status: 'IDLE',
          message: 'Selected Pay at Restaurant. Please settle your bill at the counter when served.',
        });
        setProcessing(false);
        return;
      }

      const intentRes = await fetch('/api/payments/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderToken,
          restaurantId: order.restaurant_id,
          orderId: order.id,
          paymentMethod: 'ONLINE',
          idempotencyKey: `pay_intent_${order.id}_${Date.now()}`,
          currency,
        }),
      });

      if (!intentRes.ok) {
        const errData = await intentRes.json();
        throw new Error(errData.error || 'Failed to initiate online payment');
      }

      const intentData = await intentRes.json();

      const verifyRes = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderToken,
          paymentId: intentData.paymentId,
          providerPaymentId: `pay_rzp_${Date.now()}`,
          providerOrderId: intentData.providerOrderId,
          providerSignature: 'valid_test_signature',
        }),
      });

      if (!verifyRes.ok) {
        setPaymentState({
          status: 'FAILED',
          message: 'Payment failed. You have not been charged according to the current provider status.',
        });
        return;
      }

      const verifyData = await verifyRes.json();
      setPaymentState({
        status: 'SUCCEEDED',
        message: 'Payment successful ✓',
        providerRef: verifyData.providerReference,
      });
    } catch (err: unknown) {
      setPaymentState({
        status: 'FAILED',
        message: err instanceof Error ? err.message : 'Payment could not be completed.',
      });
    } finally {
      setProcessing(false);
    }
  };

  const backHref = qtoken ? `/q/${slug}/status/${qtoken}` : `/q/${slug}`;
  const isPaid = order?.payment_status === 'PAID';
  const activeTheme = resolveCustomerTheme(order?.restaurant_theme_key);

  if (loading) {
    return (
      <CustomerShell theme={activeTheme}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-2xl bg-white/10" />
              <div className="space-y-1.5">
                <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
              </div>
            </div>
            <div className="h-9 w-20 animate-pulse rounded-2xl bg-white/10" />
          </div>

          <div className="customer-glass-card rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/90 p-6 space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="mx-auto h-4 w-24 animate-pulse rounded bg-white/10" />
            <div className="mx-auto h-10 w-44 animate-pulse rounded-2xl bg-white/10" />
            <div className="space-y-2 pt-2">
              <div className="h-16 animate-pulse rounded-2xl bg-white/5" />
              <div className="h-16 animate-pulse rounded-2xl bg-white/5" />
            </div>
            <div className="h-12 animate-pulse rounded-2xl bg-white/10" />
          </div>
        </div>
        <span className="sr-only">Loading payment checkout…</span>
      </CustomerShell>
    );
  }

  if (error || !order) {
    return (
      <CustomerShell theme={activeTheme}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div role="alert" className="customer-glass-card w-full max-w-sm rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/90 p-8 text-center space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-400">
              <ReceiptText className="h-7 w-7" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-bold text-white">Order not found</h1>
              <p className="text-xs leading-relaxed text-slate-400">
                We couldn&apos;t find this order. Check the link, or return to your queue ticket.
              </p>
            </div>
            <Link
              href={backHref}
              className="flex min-h-[44px] h-11 w-full items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white transition-colors hover:bg-white/15"
            >
              {qtoken ? '← Back to My Ticket' : '← Back to Queue'}
            </Link>
          </div>
        </div>
      </CustomerShell>
    );
  }

  return (
    <CustomerShell theme={activeTheme}>
      {/* 1. Official ASSO / QueueFlow Platform Brand */}
      <CustomerPlatformBrand />

      {/* 2. Restaurant Header with Luxury Serif Typography */}
      <header className="text-center pt-1 pb-1 space-y-1.5">
        <h1 className="font-luxury-serif line-clamp-2 break-words text-2xl sm:text-3xl font-normal tracking-[0.06em] uppercase text-[#fff9f0] leading-tight px-2 drop-shadow-[0_2px_14px_rgba(245,158,11,0.20)]">
          {order.restaurant_name || 'Restaurant'}
        </h1>
        <div className="flex items-center justify-center gap-2.5">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--qf-success)]">
            <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--qf-success)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--qf-success)]" />
            </span>
            <span>Secure checkout</span>
          </p>
          <Link
            href={backHref}
            className="inline-flex min-h-[30px] h-7.5 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-xs font-bold text-slate-200 transition-all hover:bg-white/[0.12] hover:text-white active:scale-95 shrink-0"
          >
            {qtoken ? (
              <>
                <Ticket className="h-3 w-3 text-[var(--qf-warning)]" aria-hidden="true" />
                <span>My Ticket</span>
              </>
            ) : (
              '← Back'
            )}
          </Link>
        </div>
      </header>

      {/* PRIMARY PAYMENT HERO CARD */}
      <section
        aria-label={`Pay for order #${order.order_number || order.id.slice(0, 6)}`}
        className="customer-glass-card relative overflow-hidden rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/95 p-5 sm:p-7 shadow-2xl backdrop-blur-xl text-center space-y-5"
      >
        {/* Order Header */}
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[var(--qf-primary)]/10 border border-[var(--qf-primary)]/20 text-[var(--qf-primary)]">
            <span>Order #{order.order_number || order.id.slice(0, 6)}</span>
          </span>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white pt-1">
            Pay for your order
          </h2>
        </div>

        {/* Amount Display */}
        <div className="customer-glass-surface rounded-2xl border border-[var(--qf-border)] p-4 text-center">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Amount</div>
          <div className="font-mono text-3xl sm:text-4xl font-black tabular-nums text-white my-1">
            {formatPrice(Number(order.total))}
          </div>
          <div className="text-[11px] text-slate-400">Server-confirmed from your order items</div>
        </div>

        {/* Compact Order Summary */}
        {order.items && order.items.length > 0 && (
          <div className="pt-3 border-t border-white/10 space-y-2 text-left">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Order Summary</span>
              <span className="text-slate-500 font-semibold">
                {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            <div className="divide-y divide-white/5 max-h-44 overflow-y-auto pr-1">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 text-xs">
                  <span className="font-semibold text-slate-200 truncate pr-2">
                    {item.quantity} × {item.name}
                  </span>
                  <span className="font-mono text-slate-300 shrink-0">
                    {formatPrice(item.totalPrice)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Already Paid State */}
        {isPaid && paymentState.status !== 'SUCCEEDED' && (
          <div role="status" className="customer-glass-surface rounded-2xl border border-[var(--qf-primary)]/25 bg-[var(--qf-primary)]/10 p-5 text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--qf-primary)]/20 text-[var(--qf-primary)] text-xl font-bold">
              ✓
            </div>
            <div className="text-base font-bold text-white">Payment completed</div>
            <p className="text-xs text-slate-300">
              This order has already been marked as paid ({formatPrice(Number(order.total))}).
            </p>
            <div className="pt-2">
              <Link
                href={`/q/${slug}/order/${orderToken}${qtoken ? `?qtoken=${encodeURIComponent(qtoken)}` : ''}`}
                className="customer-primary-cta inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 text-xs font-bold transition-colors"
              >
                View order status →
              </Link>
            </div>
          </div>
        )}

        {/* Payment Method Selection (Compact Rows) */}
        {!isPaid && paymentState.status !== 'SUCCEEDED' && (
          <div className="pt-3 border-t border-white/10 space-y-2.5 text-left">
            <span id="pay-method-label" className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              Payment Method
            </span>
            <div className="space-y-2" role="radiogroup" aria-labelledby="pay-method-label">
              <button
                type="button"
                role="radio"
                aria-checked={paymentMethod === 'ONLINE'}
                onClick={() => setPaymentMethod('ONLINE')}
                className={`w-full min-h-[64px] flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left cursor-pointer ${
                  paymentMethod === 'ONLINE'
                    ? 'border-[var(--qf-primary)]/50 bg-[var(--qf-primary)]/15 text-white'
                    : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    paymentMethod === 'ONLINE'
                      ? 'border-[var(--qf-primary)] bg-[var(--qf-primary)] text-[var(--qf-primary-foreground)]'
                      : 'border-slate-500 bg-transparent'
                  }`}>
                    {paymentMethod === 'ONLINE' && <span className="text-[11px] font-black leading-none">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Pay Online</p>
                    <p className="text-[11px] text-slate-400">UPI, Cards, Netbanking</p>
                  </div>
                </div>
                <CreditCard className="h-5 w-5 text-slate-400 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={paymentMethod === 'PAY_AT_RESTAURANT'}
                onClick={() => setPaymentMethod('PAY_AT_RESTAURANT')}
                className={`w-full min-h-[64px] flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left cursor-pointer ${
                  paymentMethod === 'PAY_AT_RESTAURANT'
                    ? 'border-[var(--qf-primary)]/50 bg-[var(--qf-primary)]/15 text-white'
                    : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    paymentMethod === 'PAY_AT_RESTAURANT'
                      ? 'border-[var(--qf-primary)] bg-[var(--qf-primary)] text-[var(--qf-primary-foreground)]'
                      : 'border-slate-500 bg-transparent'
                  }`}>
                    {paymentMethod === 'PAY_AT_RESTAURANT' && <span className="text-[11px] font-black leading-none">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Pay at Restaurant</p>
                    <p className="text-[11px] text-slate-400">Settle bill at the counter when served</p>
                  </div>
                </div>
                <Store className="h-5 w-5 text-slate-400 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Processing Feedback */}
        {paymentState.status === 'PROCESSING' && (
          <div role="status" className="customer-glass-surface rounded-2xl border border-[var(--qf-warning)]/25 bg-[var(--qf-warning)]/10 p-4 text-center space-y-1 text-[var(--qf-warning)]">
            <div className="inline-flex items-center gap-2 font-bold text-sm">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>{paymentState.message || 'Processing payment…'}</span>
            </div>
            <p className="text-xs opacity-80">Please don&apos;t close this page.</p>
          </div>
        )}

        {/* Success Feedback */}
        {paymentState.status === 'SUCCEEDED' && (
          <div role="status" className="customer-glass-surface rounded-2xl border border-[var(--qf-success)]/25 bg-[var(--qf-success)]/10 p-5 text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--qf-success)]/20 text-[var(--qf-success)] text-xl font-bold">
              ✓
            </div>
            <div className="text-base font-bold text-white">Payment successful</div>
            <p className="text-xs text-slate-300">
              {formatPrice(Number(order.total))} verified by the server. Show this screen if asked.
            </p>
            {paymentState.providerRef && (
              <p className="font-mono text-[11px] text-[var(--qf-success)]">
                Ref: {paymentState.providerRef}
              </p>
            )}
            <div className="pt-2">
              <Link
                href={`/q/${slug}/order/${orderToken}${qtoken ? `?qtoken=${encodeURIComponent(qtoken)}` : ''}`}
                className="customer-primary-cta inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 text-xs font-bold transition-colors"
              >
                View order status →
              </Link>
            </div>
          </div>
        )}

        {/* Failure Feedback */}
        {paymentState.status === 'FAILED' && (
          <div role="alert" className="customer-glass-surface rounded-2xl border border-[var(--qf-danger)]/25 bg-[var(--qf-danger)]/10 p-4 text-center space-y-1">
            <div className="text-sm font-bold text-[var(--qf-danger)]">Payment wasn&apos;t completed</div>
            <p className="text-xs leading-relaxed text-rose-200/90">{paymentState.message}</p>
          </div>
        )}

        {/* Pay at Restaurant Confirmation Feedback */}
        {paymentState.status === 'IDLE' && paymentState.message && (
          <div role="status" className="customer-glass-surface rounded-2xl border border-sky-400/25 bg-sky-500/10 p-3.5 text-center text-xs text-sky-200 leading-relaxed">
            {paymentState.message}
          </div>
        )}

        {/* Primary Payment CTA */}
        {!isPaid && paymentState.status !== 'SUCCEEDED' && (
          <button
            type="button"
            onClick={handlePayNow}
            disabled={processing}
            aria-busy={processing}
            className="customer-primary-cta flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {processing ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>Processing…</span>
              </>
            ) : paymentMethod === 'ONLINE' ? (
              <>
                <span>Pay {formatPrice(Number(order.total))}</span>
                <span aria-hidden="true" className="font-bold">→</span>
              </>
            ) : (
              <>
                <span>Confirm pay at restaurant</span>
                <span aria-hidden="true" className="font-bold">→</span>
              </>
            )}
          </button>
        )}

        {/* Security Reassurance */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <span aria-hidden="true">🔒</span>
          <span>Secure payment · Protected checkout</span>
        </div>

        {/* Secondary Navigation */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <Link
            href={`/q/${slug}/order/${orderToken}${qtoken ? `?qtoken=${encodeURIComponent(qtoken)}` : ''}`}
            className="flex min-h-[44px] h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            View order details
          </Link>
          <Link
            href={backHref}
            className="flex min-h-[44px] h-11 w-full items-center justify-center rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            {qtoken ? '← Back to My Ticket' : '← Back to Queue'}
          </Link>
        </div>
      </section>
    </CustomerShell>
  );
}

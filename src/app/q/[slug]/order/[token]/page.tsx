import React from 'react';
import Link from 'next/link';
import { OrderService } from '@/lib/services/order-service';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { QueueService } from '@/lib/services/queue-service';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { customerOrderStatusCopy } from '@/lib/customer-order-ux';
import { resolveCustomerTheme } from '@/lib/themes';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);

  if (!restaurant) {
    return { title: 'Order Not Found — QueueFlow' };
  }

  return {
    title: `Order Status — ${restaurant.name} | QueueFlow`,
    description: `Track live order status for ${restaurant.name}.`,
  };
}

const ORDER_STEPS = [
  { key: 'PLACED', label: 'Received' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'READY', label: 'Ready' },
  { key: 'SERVED', label: 'Served' },
];

export default async function CustomerOrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ qtoken?: string }>;
}) {
  const { slug, token } = await params;
  const { qtoken } = await searchParams;

  const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
  const orderDetails = await OrderService.getCustomerOrderStateByToken(token);

  // Phase 4H: queue-aware order page. If the customer's ticket is CALLED,
  // the return instruction leads — the order never contradicts it.
  let queueCalled = false;
  if (qtoken && restaurant) {
    try {
      const qs = await QueueService.getQueueStatusByToken(qtoken);
      queueCalled = !!qs && qs.restaurantId === restaurant.id && qs.status === 'CALLED';
    } catch {
      queueCalled = false;
    }
  }

  if (!restaurant || !orderDetails) {
    return (
      <main className="qf-bg flex min-h-[100dvh] items-center justify-center p-6 text-slate-100">
        <div className="customer-glass-card w-full max-w-sm rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/90 p-8 text-center space-y-4 shadow-2xl backdrop-blur-xl">
          <div className="text-4xl" aria-hidden="true">📦</div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-white">Order unavailable</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              We couldn&apos;t load this order right now.
            </p>
          </div>
          <a
            href={`/q/${slug}`}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white hover:bg-white/15 transition-colors"
          >
            Return to restaurant
          </a>
        </div>
      </main>
    );
  }

  // Tenant Isolation Check
  if (orderDetails.restaurantId !== restaurant.id) {
    return (
      <main className="qf-bg flex min-h-[100dvh] items-center justify-center p-6 text-slate-100">
        <div className="customer-glass-card w-full max-w-sm rounded-3xl border border-rose-500/20 bg-[var(--qf-surface)]/90 p-8 text-center space-y-4 shadow-2xl backdrop-blur-xl">
          <div className="text-4xl" aria-hidden="true">🛡️</div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-rose-300">Access Denied</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              This order belongs to a different restaurant. Cross-restaurant access is restricted.
            </p>
          </div>
          <a
            href={`/q/${slug}`}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white hover:bg-white/15 transition-colors"
          >
            Return to restaurant
          </a>
        </div>
      </main>
    );
  }

  // Phase 4G: restaurant's actual currency — never hardcoded.
  const currency = restaurant.currency || 'INR';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const formatPrice = (amount: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  };

  const getStepIndex = (status: string) => {
    if (status === 'PLACED') return 0;
    if (status === 'CONFIRMED') return 1;
    if (status === 'PREPARING') return 2;
    if (status === 'READY') return 3;
    if (status === 'SERVED') return 4;
    return 0;
  };

  const currentStep = getStepIndex(orderDetails.status);
  const isCancelled = orderDetails.status === 'CANCELLED';
  const isPaid = orderDetails.paymentStatus === 'PAID';
  const isTakeaway = orderDetails.queueType === 'TAKEAWAY';
  const activeTheme = resolveCustomerTheme(restaurant.customerThemeKey);

  return (
    <CustomerShell theme={activeTheme}>
      {/* 1. Official ASSO / QueueFlow Platform Brand */}
      <CustomerPlatformBrand />

      {/* 2. Restaurant Hero */}
      <RestaurantHeader restaurant={restaurant} />

        {/* CALLED Turn Priority Banner */}
        {queueCalled && qtoken && (
          <Link
            href={`/q/${slug}/status/${qtoken}`}
            className="flex items-center gap-3 rounded-2xl border border-sky-400/40 bg-sky-500/10 p-3.5 shadow-md transition-all hover:bg-sky-500/15 active:scale-[0.99]"
          >
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-white">
                {isTakeaway ? 'Your takeaway order is ready! 📢' : 'Your turn is here — please return 📢'}
              </span>
              <span className="block text-xs text-sky-200/80">
                {isTakeaway ? 'Please proceed to the takeaway counter' : 'Your order is safe · tap to open your ticket'}
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-sky-300 font-bold">→</span>
          </Link>
        )}

        {/* PRIMARY HERO CARD: ORDER STATUS & CONFIRMATION */}
        <section
          aria-label={`Order #${orderDetails.orderNumber} status`}
          className="customer-glass-card relative overflow-hidden rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/95 p-5 sm:p-7 shadow-2xl backdrop-blur-xl text-center space-y-5"
        >
          {/* Header & Order Number */}
          <div className="space-y-1.5">
            <div>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  isCancelled
                    ? 'bg-rose-500/15 border border-rose-500/25 text-rose-300'
                    : orderDetails.status === 'READY'
                    ? 'bg-sky-500/15 border border-sky-500/25 text-sky-300'
                    : orderDetails.status === 'SERVED'
                    ? 'bg-[var(--qf-primary)]/15 border border-[var(--qf-primary)]/25 text-[var(--qf-primary)]'
                    : 'bg-[var(--qf-primary)]/10 border border-[var(--qf-primary)]/20 text-[var(--qf-primary)]'
                }`}
              >
                <span>{isCancelled ? '✕' : '✓'}</span>
                <span>{isCancelled ? 'Order cancelled' : isTakeaway ? 'Takeaway order placed' : 'Order placed'}</span>
              </span>
            </div>

            <h1 className="font-mono text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums my-1 motion-safe:animate-numberPop">
              Order #{orderDetails.orderNumber}
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 max-w-[280px] mx-auto leading-relaxed">
              {customerOrderStatusCopy(orderDetails.status)}
            </p>
          </div>

          {/* Simple Linear Progress Track */}
          {!isCancelled && (
            <div className="pt-2 border-t border-white/5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold px-1 text-slate-400">
                {ORDER_STEPS.map((step, idx) => {
                  const isDone = idx <= currentStep;
                  const isCurrent = idx === currentStep;

                  return (
                    <span
                      key={step.key}
                      className={
                        isCurrent
                          ? 'text-[var(--qf-primary)] font-extrabold'
                          : isDone
                          ? 'text-white'
                          : 'text-slate-600'
                      }
                    >
                      {step.label}
                    </span>
                  );
                })}
              </div>

              {/* Smooth progress bar */}
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--qf-primary)] rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(12, ((currentStep + 1) / ORDER_STEPS.length) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* ORDER RECEIPT & ITEMS */}
          <div className="pt-4 border-t border-white/10 space-y-3 text-left">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Order Items
              </h2>
              <span className="text-xs font-semibold text-slate-500">
                {orderDetails.items.length} {orderDetails.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {orderDetails.items.map((item: { id: string; name: string; quantity: number; totalPrice: number; specialInstructions?: string | null }) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between py-2.5 text-xs first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5 min-w-0 flex-1 pr-3">
                    <p className="font-semibold text-white leading-snug">
                      {item.quantity} × {item.name}
                    </p>
                    {item.specialInstructions && (
                      <p className="text-[11px] text-slate-400 italic">
                        Note: “{item.specialInstructions}”
                      </p>
                    )}
                  </div>
                  <span className="font-mono font-semibold text-white shrink-0">
                    {formatPrice(item.totalPrice)}
                  </span>
                </div>
              ))}
            </div>

            {/* Bill Summary */}
            <div className="pt-3 border-t border-white/10 space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-mono text-slate-200">
                  {formatPrice(orderDetails.subtotal ?? orderDetails.total)}
                </span>
              </div>
              {typeof orderDetails.tax === 'number' && orderDetails.tax > 0 && (
                <div className="flex justify-between">
                  <span>Taxes &amp; Fees</span>
                  <span className="font-mono text-slate-200">{formatPrice(orderDetails.tax)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-2 border-t border-white/5 text-white font-bold">
                <span className="text-sm">Total Amount</span>
                <span className="font-mono text-xl font-black text-[var(--qf-primary)]">
                  {formatPrice(orderDetails.total)}
                </span>
              </div>
            </div>
          </div>

          {/* PAYMENT STATUS & PRIMARY ACTION */}
          <div className="pt-3 border-t border-white/10 space-y-3">
            {isPaid ? (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-[var(--qf-primary)]/10 border border-[var(--qf-primary)]/20 text-left">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--qf-primary)]/20 text-[var(--qf-primary)] text-sm font-bold">
                    ✓
                  </span>
                  <div>
                    <p className="text-xs font-bold text-[var(--qf-primary)]">Payment completed</p>
                    <p className="text-[11px] text-[var(--qf-primary)]/70">Payment confirmed by restaurant</p>
                  </div>
                </div>
                {!isTakeaway && (
                  <a
                    href={qtoken ? `/q/${slug}/payment/${token}?qtoken=${encodeURIComponent(qtoken)}` : `/q/${slug}/payment/${token}`}
                    className="text-xs font-semibold text-[var(--qf-primary)] hover:underline transition-colors"
                  >
                    Receipt →
                  </a>
                )}
              </div>
            ) : isTakeaway ? (
              <div className="rounded-2xl border border-[var(--qf-primary)]/30 bg-[var(--qf-primary)]/10 p-4 text-center space-y-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--qf-primary)]/20 text-[var(--qf-primary)] text-xs font-black tracking-wide uppercase">
                  💵 PAY AT COUNTER
                </span>
                <p className="text-xs font-bold text-slate-200">
                  You can pay when collecting your order.
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Please show your takeaway ticket to the staff when your order is called.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <a
                  href={qtoken ? `/q/${slug}/payment/${token}?qtoken=${encodeURIComponent(qtoken)}` : `/q/${slug}/payment/${token}`}
                  className="customer-primary-cta flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-[0.99]"
                >
                  <span>Pay {formatPrice(Number(orderDetails.total))}</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </a>
                <p className="text-center text-[11px] text-slate-400">
                  Pay online now or pay at the restaurant checkout.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Queue Spot Reassurance */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-left">
          <span className="text-base shrink-0" aria-hidden="true">🎟️</span>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {isTakeaway
              ? 'Your takeaway order is in the queue — you will be notified when it is ready to collect!'
              : 'Ordering food does not affect your queue spot — your place in line remains active!'}
          </p>
        </div>

        {/* Navigation & Secondary Actions */}
        <div className="space-y-2 pt-1">
          <a
            href={qtoken ? `/q/${slug}/status/${qtoken}` : `/q/${slug}`}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            {qtoken ? '← Back to My Ticket' : '← Back to Digital Queue'}
          </a>

          <div className="text-center pt-1">
            <Link
              href={`/q/${slug}/menu${qtoken ? `?qtoken=${encodeURIComponent(qtoken)}` : ''}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span>Browse menu again</span>
              <span>→</span>
            </Link>
          </div>
        </div>
    </CustomerShell>
  );
}

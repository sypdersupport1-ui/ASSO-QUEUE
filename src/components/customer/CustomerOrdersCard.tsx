'use client';

import React from 'react';
import Link from 'next/link';
import { ReceiptText, ChevronRight } from 'lucide-react';

export interface CustomerOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  itemCount: number;
  items: { name: string; quantity: number; totalPrice: number }[];
}

interface CustomerOrdersCardProps {
  orders: CustomerOrderSummary[];
  restaurantSlug: string;
  queueToken: string;
}

const STATUS_STYLE: Record<string, string> = {
  PLACED: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  CONFIRMED: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
  PREPARING: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
  READY: 'bg-[var(--qf-success)]/15 border-[var(--qf-success)]/30 text-[var(--qf-success)]',
  SERVED: 'bg-[var(--qf-success)]/15 border-[var(--qf-success)]/30 text-[var(--qf-success)]',
  CANCELLED: 'bg-slate-500/15 border-slate-600 text-slate-400',
};

/**
 * "My Orders" — shows every pre-order placed from this queue ticket.
 * Fixes the lost-order UX: previously placing an order navigated away
 * and the ticket page showed no order history.
 */
export function CustomerOrdersCard({ orders, restaurantSlug, queueToken }: CustomerOrdersCardProps) {
  if (!orders || orders.length === 0) return null;
  const menuUrl = `/q/${restaurantSlug}/menu?qtoken=${queueToken}`;

  return (
    <section
      aria-label={`My orders, ${orders.length} order${orders.length === 1 ? '' : 's'}`}
      className="customer-glass-card animate-fadeUp p-5 sm:p-6"
      style={{ animationDelay: '180ms' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-black tracking-tight text-white">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--qf-primary)]/15 border border-[var(--qf-border)] text-[var(--qf-primary)] shadow-sm">
            <ReceiptText aria-hidden="true" className="h-4 w-4" />
          </span>
          My Orders ({orders.length})
        </h2>
        <Link
          href={menuUrl}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-bold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          + Add more <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[var(--qf-primary)]" />
        </Link>
      </div>

      <ul className="mt-3 space-y-2.5">
        {orders.map((o) => (
          <li
            key={o.id}
            className="rounded-2xl border border-[var(--qf-border)] bg-white/[0.04] p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-white">
                Order #{o.orderNumber}
                <span className="ml-2 text-[11px] font-semibold text-slate-400">
                  {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · ₹{Number(o.total).toFixed(2)}
                </span>
              </p>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[o.status] || STATUS_STYLE.PLACED}`}
              >
                {o.status}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-slate-400">
              {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {o.paymentStatus === 'PAID' ? '✓ Paid' : 'Payment pending'}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
        Ordering does not affect your queue position — your spot is still saved.
      </p>
    </section>
  );
}

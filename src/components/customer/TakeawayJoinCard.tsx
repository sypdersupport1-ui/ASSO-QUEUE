'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useActionState } from 'react';
import { ShoppingBag, ArrowRight, User, Phone, LoaderCircle, TriangleAlert, UtensilsCrossed } from 'lucide-react';
import { joinQueuePublicAction, JoinQueueState } from '@/app/q/actions';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { normalizePhoneForSubmit, mapJoinErrorToUX, type JoinFormErrors } from '@/lib/customer-join-ux';

interface TakeawayJoinCardProps {
  restaurant: PublicRestaurantInfo;
}

/**
 * Phase 2 — Customer Takeaway Card.
 *
 * Provides two clear customer choices:
 * 1. Order Online Now: Jump straight to menu & cart (primary flow).
 * 2. Join Pickup Queue: Quick join with Name and Phone only (NO party size, NO seating).
 */
export function TakeawayJoinCard({ restaurant }: TakeawayJoinCardProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<JoinFormErrors>({});
  const [showQuickJoin, setShowQuickJoin] = useState(false);

  const [state, formAction, isPending] = useActionState<JoinQueueState | null, FormData>(
    joinQueuePublicAction,
    null
  );

  const serverError = state?.error ? mapJoinErrorToUX(state.error) : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isPending) {
      e.preventDefault();
      return;
    }
    const errors: JoinFormErrors = {};
    if (!name.trim()) {
      errors.name = 'Please enter your name';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      e.preventDefault();
    }
  }

  return (
    <section
      aria-label="Takeaway order and queue"
      className="relative space-y-5 rounded-3xl border border-white/10 bg-slate-900/90 p-5 sm:p-7 shadow-2xl backdrop-blur-xl"
    >
      <div className="space-y-1 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-400">
          <ShoppingBag className="h-3 w-3" />
          <span>Takeaway Pickup</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
          Order &amp; Collect
        </h2>
        <p className="text-xs text-slate-400">
          Pay at the counter when you pick up your order.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-center"
        >
          <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-rose-200">
            <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
            {serverError.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-rose-300/90">
            {serverError.body}
          </p>
        </div>
      )}

      {/* Primary Action: Order From Menu */}
      <div className="space-y-2.5">
        <Link
          href={`/q/${restaurant.slug}/menu?service=takeaway`}
          className="flex min-h-[54px] h-13 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-sm tracking-wide shadow-xl shadow-emerald-500/20 transition-all active:scale-[0.99]"
        >
          <UtensilsCrossed className="h-4 w-4" />
          <span>Browse Menu &amp; Order</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="text-center text-[11px] text-slate-400">
          Select items, review your cart, and get your takeaway ticket.
        </p>
      </div>

      {/* Secondary Choice: Quick Join Queue without ordering first */}
      <div className="pt-2 border-t border-white/10">
        {!showQuickJoin ? (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowQuickJoin(true)}
              className="text-xs font-bold text-slate-400 hover:text-white underline underline-offset-4 transition-colors cursor-pointer py-1"
            >
              Prefer to order in person? Join Takeaway Queue →
            </button>
          </div>
        ) : (
          <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-3.5 pt-1 animate-fadeUp">
            <input type="hidden" name="restaurantId" value={restaurant.id} />
            <input type="hidden" name="restaurantSlug" value={restaurant.slug} />
            <input type="hidden" name="partySize" value="1" />
            <input type="hidden" name="queueType" value="TAKEAWAY" />
            <input type="hidden" name="customerPhone" value={normalizePhoneForSubmit(phone)} />

            <div className="space-y-1 text-left">
              <label htmlFor="takeawayCustomerName" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Your name <span aria-hidden="true" className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <User aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="takeawayCustomerName"
                  type="text"
                  name="customerName"
                  required
                  autoComplete="name"
                  placeholder="e.g. Rahul Sharma"
                  disabled={isPending}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.name)}
                  className="w-full rounded-2xl border border-slate-700/80 bg-slate-950/80 py-3 pl-10 pr-4 text-[14px] text-white placeholder-slate-500 transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              {fieldErrors.name && (
                <p role="alert" className="text-xs font-semibold text-rose-300">
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <div className="space-y-1 text-left">
              <label htmlFor="takeawayCustomerPhone" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Mobile <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <div className="relative">
                <Phone aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="takeawayCustomerPhone"
                  type="tel"
                  inputMode="tel"
                  placeholder="98765 43210"
                  disabled={isPending}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700/80 bg-slate-950/80 py-3 pl-10 pr-4 text-[14px] text-white placeholder-slate-500 transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-black tracking-wide shadow-md transition-all active:scale-[0.99] cursor-pointer"
            >
              {isPending ? (
                <>
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  <span>Securing spot…</span>
                </>
              ) : (
                <>
                  <ShoppingBag aria-hidden="true" className="h-4 w-4" />
                  <span>Join Takeaway Queue</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

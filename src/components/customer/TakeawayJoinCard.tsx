'use client';

import React, { useState } from 'react';
import { useActionState } from 'react';
import { ShoppingBag, ArrowRight, User, Phone, LoaderCircle, TriangleAlert } from 'lucide-react';
import { joinQueuePublicAction, JoinQueueState } from '@/app/q/actions';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { normalizePhoneForSubmit, mapJoinErrorToUX, type JoinFormErrors } from '@/lib/customer-join-ux';

interface TakeawayJoinCardProps {
  restaurant: PublicRestaurantInfo;
}

/**
 * Queue-First Takeaway Join Card.
 *
 * Mandatory Workflow:
 * QR → Service Selection (Takeaway) → Name + Phone ONLY → JOIN QUEUE → Ticket Created.
 *
 * Ordering is secondary and optional after the ticket exists.
 * ZERO party size, ZERO table seating.
 */
export function TakeawayJoinCard({ restaurant }: TakeawayJoinCardProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<JoinFormErrors>({});

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
      aria-label="Takeaway queue join"
      className="relative space-y-5 rounded-3xl border border-white/10 bg-slate-900/90 p-5 sm:p-7 shadow-2xl backdrop-blur-xl"
    >
      <div className="space-y-1 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-400">
          <ShoppingBag className="h-3 w-3" />
          <span>Takeaway Queue</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
          Join Takeaway Line
        </h2>
        <p className="text-xs text-slate-400">
          Get your digital takeaway ticket first. You can browse the menu after joining.
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

      <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-4">
        <input type="hidden" name="restaurantId" value={restaurant.id} />
        <input type="hidden" name="restaurantSlug" value={restaurant.slug} />
        <input type="hidden" name="partySize" value="1" />
        <input type="hidden" name="queueType" value="TAKEAWAY" />
        <input type="hidden" name="customerPhone" value={normalizePhoneForSubmit(phone)} />

        {/* Customer Name */}
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
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
              }}
              className={`h-12 w-full rounded-2xl border bg-slate-950/80 pl-10 pr-4 text-sm text-white placeholder-slate-500 transition-all focus:outline-none ${
                fieldErrors.name
                  ? 'border-rose-500/80 focus:ring-2 focus:ring-rose-500/30'
                  : 'border-white/10 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20'
              }`}
            />
          </div>
          {fieldErrors.name && (
            <p className="text-[11px] font-medium text-rose-400 pl-1">{fieldErrors.name}</p>
          )}
        </div>

        {/* Phone Number (Optional for buzzer/SMS) */}
        <div className="space-y-1 text-left">
          <label htmlFor="takeawayCustomerPhone" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            Mobile phone <span className="text-[10px] text-slate-500 font-normal">(Optional for notifications)</span>
          </label>
          <div className="relative">
            <Phone aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id="takeawayCustomerPhone"
              type="tel"
              autoComplete="tel"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (fieldErrors.phone) setFieldErrors((p) => ({ ...p, phone: undefined }));
              }}
              className={`h-12 w-full rounded-2xl border bg-slate-950/80 pl-10 pr-4 text-sm text-white placeholder-slate-500 transition-all focus:outline-none ${
                fieldErrors.phone
                  ? 'border-rose-500/80 focus:ring-2 focus:ring-rose-500/30'
                  : 'border-white/10 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20'
              }`}
            />
          </div>
          {fieldErrors.phone && (
            <p className="text-[11px] font-medium text-rose-400 pl-1">{fieldErrors.phone}</p>
          )}
        </div>

        {/* Primary CTA: Join Takeaway Queue */}
        <button
          type="submit"
          disabled={isPending}
          className="flex min-h-[54px] h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 hover:brightness-110 active:scale-[0.99] text-slate-950 font-black text-sm tracking-wide shadow-xl shadow-emerald-500/25 transition-all disabled:opacity-50 cursor-pointer"
        >
          {isPending ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Saving your spot...</span>
            </>
          ) : (
            <>
              <span>Join Takeaway Queue</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="text-center text-[11px] text-slate-400">
          No table seating required. You will be called to the counter when ready.
        </p>
      </form>
    </section>
  );
}

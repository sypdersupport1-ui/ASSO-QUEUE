'use client';

import React, { useState } from 'react';
import { useActionState } from 'react';
import { Ticket, ArrowRight, User, Phone, LoaderCircle, TriangleAlert } from 'lucide-react';
import { joinQueuePublicAction, JoinQueueState } from '@/app/q/actions';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { PartySizeSelector } from './PartySizeSelector';
import {
  validateJoinForm,
  normalizePhoneForSubmit,
  mapJoinErrorToUX,
  type JoinFormErrors,
} from '@/lib/customer-join-ux';

interface QueueJoinFormProps {
  restaurant: PublicRestaurantInfo;
}

/**
 * Phase 4A — Mobile-first join form.
 *
 * - Client validation is instant UX only; `JoinQueueSchema` + the atomic
 *   `join_queue_atomic` RPC remain authoritative (server decides).
 * - Phone is sent trim-only so the exact-match duplicate guard keeps working.
 * - Raw tokens never touch this component: success redirects server-side
 *   to the ticket URL and the HttpOnly cookie flow takes over. No
 *   browser-side persistence of credentials anywhere in this component.
 */
export function QueueJoinForm({ restaurant }: QueueJoinFormProps) {
  const minParty = restaurant.minPartySize || 1;
  const maxParty = restaurant.maxPartySize || 20;

  const [partySize, setPartySize] = useState<number>(() => Math.min(2, maxParty));
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
    const errors = validateJoinForm(
      { name, phone, partySize },
      { minParty, maxParty }
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      e.preventDefault();
    }
  }

  return (
    <section
      aria-label="Join the queue"
      className="relative space-y-5 rounded-3xl border border-white/10 bg-slate-900/90 p-5 sm:p-7 shadow-2xl backdrop-blur-xl"
    >
      <div className="space-y-1 text-center">
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
          Save your spot in line
        </h2>
        <p className="text-xs text-slate-400">
          We&apos;ll notify you when your table is almost ready.
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
        <input type="hidden" name="partySize" value={partySize} />
        <input type="hidden" name="customerPhone" value={normalizePhoneForSubmit(phone)} />

        <PartySizeSelector
          value={partySize}
          min={minParty}
          max={maxParty}
          disabled={isPending}
          error={fieldErrors.partySize}
          onChange={(next) => {
            setPartySize(next);
            setFieldErrors((prev) => ({ ...prev, partySize: undefined }));
          }}
        />

        <div className="space-y-1.5 text-left">
          <label htmlFor="customerName" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            Your name <span aria-hidden="true" className="text-emerald-400">*</span>
          </label>
          <div className="relative">
            <User aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id="customerName"
              type="text"
              name="customerName"
              required
              autoComplete="name"
              autoCapitalize="words"
              maxLength={100}
              placeholder="e.g. Rahul Sharma"
              disabled={isPending}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'customerName-error' : undefined}
              className="w-full rounded-2xl border border-slate-700/80 bg-slate-950/80 py-3.5 pl-10 pr-4 text-[15px] text-white placeholder-slate-500 transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          {fieldErrors.name && (
            <p id="customerName-error" role="alert" className="text-xs font-semibold text-rose-300">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div className="space-y-1.5 text-left">
          <label htmlFor="customerPhoneDisplay" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            Mobile <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <div className="relative">
            <Phone aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id="customerPhoneDisplay"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              disabled={isPending}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setFieldErrors((prev) => ({ ...prev, phone: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? 'customerPhone-error customerPhone-hint' : 'customerPhone-hint'}
              className="w-full rounded-2xl border border-slate-700/80 bg-slate-950/80 py-3.5 pl-10 pr-4 text-[15px] text-white placeholder-slate-500 transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          {fieldErrors.phone && (
            <p id="customerPhone-error" role="alert" className="text-xs font-semibold text-rose-300">
              {fieldErrors.phone}
            </p>
          )}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="relative flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-sm font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {isPending ? (
              <>
                <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
                <span role="status">Securing your spot…</span>
              </>
            ) : (
              <>
                <Ticket aria-hidden="true" className="h-4 w-4" />
                <span>Get my ticket</span>
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </>
            )}
          </button>
          <p className="text-center text-[11px] text-slate-400 mt-2.5">
            Free · No app download needed
          </p>
        </div>
      </form>
    </section>
  );
}

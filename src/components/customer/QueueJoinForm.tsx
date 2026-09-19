'use client';

import React, { useState } from 'react';
import { useActionState } from 'react';
import { Ticket, ArrowRight, User, Phone, TriangleAlert } from 'lucide-react';
import { joinQueuePublicAction, JoinQueueState } from '@/app/q/actions';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { PartySizeSelector } from './PartySizeSelector';
import { CustomerSurface } from './ui/CustomerSurface';
import { CustomerInput } from './ui/CustomerInput';
import { CustomerButton } from './ui/CustomerButton';
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
 * Mobile-first Dine-In queue join form.
 *
 * - Client validation is instant UX only; `JoinQueueSchema` + the atomic
 *   `join_queue_atomic` RPC remain authoritative.
 * - Phone is sent trim-only so the exact-match duplicate guard keeps working.
 * - Raw tokens never touch this component: success redirects server-side
 *   to the ticket URL and the HttpOnly cookie flow takes over.
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
    <CustomerSurface
      aria-label="Join the dine-in queue"
      variant="card"
      className="space-y-4 sm:space-y-5"
    >
      <div className="space-y-1 text-center">
        <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
          Join Dine-In Line
        </h2>
        <p className="text-xs text-slate-400">
          Save your spot for table dining. We will notify you when your table is called.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-center space-y-1"
        >
          <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-rose-200">
            <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
            {serverError.title}
          </p>
          <p className="text-xs leading-relaxed text-rose-300/90">
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

        <CustomerInput
          id="customerName"
          name="customerName"
          label="Your name"
          required
          autoComplete="name"
          autoCapitalize="words"
          maxLength={100}
          placeholder="e.g. Rahul Sharma"
          disabled={isPending}
          value={name}
          error={fieldErrors.name}
          icon={<User className="h-4 w-4" />}
          onChange={(e) => {
            setName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, name: undefined }));
          }}
        />

        <CustomerInput
          id="customerPhoneDisplay"
          name="customerPhoneDisplay"
          label="Mobile Phone"
          hint="Optional for notifications"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="e.g. 98765 43210"
          disabled={isPending}
          value={phone}
          error={fieldErrors.phone}
          icon={<Phone className="h-4 w-4" />}
          onChange={(e) => {
            setPhone(e.target.value);
            setFieldErrors((prev) => ({ ...prev, phone: undefined }));
          }}
        />

        <div className="pt-2">
          <CustomerButton
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            isLoading={isPending}
            loadingText="Securing your spot…"
            leftIcon={<Ticket className="h-4 w-4" />}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            Join Dine-In Queue
          </CustomerButton>
          <p className="text-center text-[11px] text-slate-400 mt-2.5">
            Free · No app download needed
          </p>
        </div>
      </form>
    </CustomerSurface>
  );
}


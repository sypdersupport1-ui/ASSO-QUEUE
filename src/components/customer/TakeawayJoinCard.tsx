'use client';

import React, { useState } from 'react';
import { useActionState } from 'react';
import { ShoppingBag, ArrowRight, User, Phone, TriangleAlert } from 'lucide-react';
import { joinQueuePublicAction, JoinQueueState } from '@/app/q/actions';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { CustomerSurface } from './ui/CustomerSurface';
import { CustomerInput } from './ui/CustomerInput';
import { CustomerButton } from './ui/CustomerButton';
import { CustomerBadge } from './ui/CustomerBadge';
import { normalizePhoneForSubmit, mapJoinErrorToUX, type JoinFormErrors } from '@/lib/customer-join-ux';
import { requestUserQueueAlerts } from '@/lib/notifications/web-notification';

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
    // Explicit user activation gesture: request browser lock-screen notification permission
    requestUserQueueAlerts().catch(() => {});

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
    <CustomerSurface
      aria-label="Takeaway queue join"
      variant="card"
      className="space-y-4 sm:space-y-5"
    >
      <div className="space-y-2 text-center">
        <div className="flex justify-center">
          <CustomerBadge variant="warning" icon={<ShoppingBag className="h-3 w-3" />}>
            Takeaway Service
          </CustomerBadge>
        </div>
        <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
          Join Takeaway Line
        </h2>
        <p className="text-xs text-slate-400">
          Save your spot for counter pickup. You will be notified when your order is called.
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
        <input type="hidden" name="partySize" value="1" />
        <input type="hidden" name="queueType" value="TAKEAWAY" />
        <input type="hidden" name="customerPhone" value={normalizePhoneForSubmit(phone)} />

        <CustomerInput
          id="takeawayCustomerName"
          name="customerName"
          label="Your name"
          required
          autoComplete="name"
          placeholder="e.g. Rahul Sharma"
          disabled={isPending}
          value={name}
          error={fieldErrors.name}
          icon={<User className="h-4 w-4" />}
          onChange={(e) => {
            setName(e.target.value);
            if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
          }}
        />

        <CustomerInput
          id="takeawayCustomerPhone"
          name="takeawayCustomerPhone"
          label="Mobile phone"
          hint="Optional for notifications"
          type="tel"
          autoComplete="tel"
          placeholder="e.g. 98765 43210"
          disabled={isPending}
          value={phone}
          error={fieldErrors.phone}
          icon={<Phone className="h-4 w-4" />}
          onChange={(e) => {
            setPhone(e.target.value);
            if (fieldErrors.phone) setFieldErrors((p) => ({ ...p, phone: undefined }));
          }}
        />

        <div className="pt-2">
          <CustomerButton
            type="submit"
            variant="takeaway"
            size="lg"
            className="w-full"
            isLoading={isPending}
            loadingText="Saving your spot…"
            leftIcon={<ShoppingBag className="h-4 w-4" />}
            rightIcon={<ArrowRight className="h-4 w-4" />}
            onClick={() => {
              requestUserQueueAlerts().catch(() => {});
            }}
          >
            Join Takeaway Queue
          </CustomerButton>
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400 mt-2.5">
            <span>🔔 Lock-screen alerts &amp; buzzer sound enabled</span>
          </p>
          <p className="text-center text-[11px] text-slate-500 mt-1">
            No table wait · Direct counter collection
          </p>
        </div>
      </form>
    </CustomerSurface>
  );
}


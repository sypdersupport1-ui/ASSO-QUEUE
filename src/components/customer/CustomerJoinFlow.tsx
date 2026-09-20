'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useActionState } from 'react';
import { Ticket, ArrowRight, User, Phone, TriangleAlert, X, ShoppingBag } from 'lucide-react';
import { joinQueuePublicAction, JoinQueueState } from '@/app/q/actions';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { ServiceSelector } from './ServiceSelector';
import { PartySizeSelector } from './PartySizeSelector';
import { CustomerInput } from './ui/CustomerInput';
import { CustomerButton } from './ui/CustomerButton';
import {
  validateJoinForm,
  normalizePhoneForSubmit,
  mapJoinErrorToUX,
  type JoinFormErrors,
} from '@/lib/customer-join-ux';

interface CustomerJoinFlowProps {
  restaurant: PublicRestaurantInfo;
  initialService?: 'DINE_IN' | 'TAKEAWAY' | null;
}

/**
 * Canonical Mobile Customer Join Flow
 *
 * Implements the canonical mobile hierarchy:
 * 5. "How would you like to dine?" (Service tiles)
 * 6. Dine-In / Takeaway selection
 * 7. Party Size (placed immediately after service selection)
 * 8. Join Queue primary CTA (52–60px tall, theme-aware, directly after party size)
 *
 * Tapping the Join CTA smoothly presents an accessible guest details sheet
 * to collect Name (required) and Phone (optional) before executing the authoritative
 * atomic `joinQueuePublicAction`.
 */
export function CustomerJoinFlow({
  restaurant,
  initialService = null,
}: CustomerJoinFlowProps) {
  const isTakeawayEnabled = Boolean(restaurant.takeawayEnabled);
  const minParty = restaurant.minPartySize || 1;
  const maxParty = restaurant.maxPartySize || 20;

  const [selectedService, setSelectedService] = useState<'DINE_IN' | 'TAKEAWAY'>(() => {
    if (isTakeawayEnabled && initialService === 'TAKEAWAY') return 'TAKEAWAY';
    return 'DINE_IN';
  });

  const [partySize, setPartySize] = useState<number>(() => Math.min(2, maxParty));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<JoinFormErrors>({});

  const [state, formAction, isPending] = useActionState<JoinQueueState | null, FormData>(
    joinQueuePublicAction,
    null
  );

  const serverError = state?.error ? mapJoinErrorToUX(state.error) : null;
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus name input when sheet opens
  useEffect(() => {
    if (!isSheetOpen) return;
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isSheetOpen]);

  // Handle ESC key to dismiss sheet
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isSheetOpen) {
        setIsSheetOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSheetOpen]);

  function handleOpenSheet() {
    setIsSheetOpen(true);
  }

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isPending) {
      e.preventDefault();
      return;
    }
    const errors = validateJoinForm(
      {
        name,
        phone,
        partySize: selectedService === 'TAKEAWAY' ? 1 : partySize,
      },
      { minParty: 1, maxParty }
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      e.preventDefault();
    }
  }

  const effectivePartySize = selectedService === 'TAKEAWAY' ? 1 : partySize;
  const isTakeaway = selectedService === 'TAKEAWAY';

  return (
    <>
      {/* ── Main Glass Card: Service Selection → Party Size → Join CTA ─────── */}
      <section
        aria-label="Queue reservation"
        className="customer-glass-card p-4 sm:p-5 space-y-4 text-left"
      >
        {/* 5 & 6. "How would you like to dine?" / Service Selection */}
        {isTakeawayEnabled ? (
          <ServiceSelector
            selectedService={selectedService}
            onSelectService={setSelectedService}
          />
        ) : (
          <div className="text-center space-y-1 pb-1">
            <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
              How would you like to dine?
            </h2>
            <p className="text-xs text-slate-400">
              Table service inside · Save your spot in line
            </p>
          </div>
        )}

        {/* 7. Party Size (Placed immediately after service selection) */}
        {!isTakeaway ? (
          <div className="pt-1">
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
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--qf-accent-takeaway)]/25 bg-[var(--qf-accent-takeaway-glow)] p-3 text-center">
            <p className="text-xs font-bold text-amber-200">
              Takeaway Counter Service
            </p>
            <p className="text-[11px] text-amber-300/80 mt-0.5">
              Direct counter pickup · No table wait required
            </p>
          </div>
        )}

        {/* 8. Join Queue Primary CTA (Directly after Party Size, 52–60px tall) */}
        <div className="pt-1.5 space-y-2">
          {name.trim() ? (
            <div className="flex items-center justify-between px-1 text-xs text-slate-300">
              <span className="truncate">
                Guest: <strong className="text-white">{name}</strong>
              </span>
              <button
                type="button"
                onClick={handleOpenSheet}
                className="text-[11px] font-semibold text-[var(--qf-primary)] hover:underline cursor-pointer"
              >
                Edit
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleOpenSheet}
            className={`w-full min-h-[54px] h-14 rounded-2xl flex items-center justify-between px-5 font-black text-sm sm:text-base tracking-wide transition-all active:scale-[0.98] cursor-pointer shadow-lg select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] ${
              isTakeaway
                ? 'bg-[var(--qf-accent-takeaway)] hover:bg-amber-400 text-slate-950 shadow-amber-500/15 focus-visible:ring-[var(--qf-accent-takeaway)]'
                : 'bg-[var(--qf-primary)] hover:bg-[var(--qf-primary-hover)] text-[var(--qf-primary-foreground)] shadow-black/25 focus-visible:ring-[var(--qf-primary)]'
            }`}
          >
            <span className="flex items-center gap-2.5">
              {isTakeaway ? (
                <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Ticket className="h-5 w-5" aria-hidden="true" />
              )}
              <span>
                {isTakeaway ? 'JOIN TAKEAWAY QUEUE' : 'JOIN QUEUE'}
              </span>
            </span>
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>

          <p className="text-center text-[11px] text-slate-400 pt-0.5">
            Free · No app download needed · Instant notifications
          </p>
        </div>
      </section>

      {/* ── Guest Details Sheet (Accessible Bottom Drawer / Modal) ─────────── */}
      {isSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-sheet-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm motion-safe:animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSheetOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-white/15 bg-[#0e1420]/95 backdrop-blur-xl p-5 sm:p-6 shadow-2xl space-y-4 motion-safe:animate-slideUp max-h-[90dvh] overflow-y-auto">
            {/* Sheet Header */}
            <div className="flex items-center justify-between pb-1 border-b border-white/10">
              <div>
                <h3 id="join-sheet-title" className="text-base sm:text-lg font-black text-white">
                  {isTakeaway ? 'Join Takeaway Line' : 'Join Dine-In Line'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isTakeaway
                    ? 'Counter pickup · Single order'
                    : `Table service · ${effectivePartySize} ${effectivePartySize === 1 ? 'Guest' : 'Guests'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSheetOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Close guest details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Server Error Alert */}
            {serverError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-center space-y-0.5"
              >
                <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-rose-200">
                  <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {serverError.title}
                </p>
                <p className="text-xs text-rose-300/90 leading-snug">
                  {serverError.body}
                </p>
              </div>
            )}

            {/* Form */}
            <form action={formAction} onSubmit={handleFormSubmit} noValidate className="space-y-3.5">
              <input type="hidden" name="restaurantId" value={restaurant.id} />
              <input type="hidden" name="restaurantSlug" value={restaurant.slug} />
              <input type="hidden" name="partySize" value={effectivePartySize} />
              <input type="hidden" name="queueType" value={selectedService} />
              <input type="hidden" name="customerPhone" value={normalizePhoneForSubmit(phone)} />

              <CustomerInput
                ref={nameInputRef}
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
                  variant={isTakeaway ? 'takeaway' : 'primary'}
                  size="lg"
                  className="w-full h-14"
                  isLoading={isPending}
                  loadingText="Securing your spot…"
                  leftIcon={isTakeaway ? <ShoppingBag className="h-4 w-4" /> : <Ticket className="h-4 w-4" />}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                >
                  {isTakeaway ? 'Confirm & Join Takeaway' : 'Confirm & Join Queue'}
                </CustomerButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

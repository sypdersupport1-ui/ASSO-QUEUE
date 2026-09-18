'use client';

import React, { useState } from 'react';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { ServiceSelector } from './ServiceSelector';
import { QueueJoinForm } from './QueueJoinForm';
import { TakeawayJoinCard } from './TakeawayJoinCard';

interface CustomerJoinFlowProps {
  restaurant: PublicRestaurantInfo;
  /**
   * Pre-select a service when the customer arrives via a typed/deep link
   * (e.g. ?service=takeaway). Omit or pass null to start at the selector
   * screen (the default for plain QR scans).
   */
  initialService?: 'DINE_IN' | 'TAKEAWAY' | null;
}

/**
 * Unified Customer Join Flow.
 *
 * Invariant: If takeaway is disabled on the restaurant, this renders the
 * classic Dine-In QueueJoinForm with ZERO extra steps.
 *
 * If takeaway is enabled:
 *   - When initialService is null (plain QR scan), the customer sees the
 *     ServiceSelector FIRST. The join form only appears after they pick.
 *   - When initialService is set (?service=dine_in / ?service=takeaway deep
 *     links), we skip straight to that form so typed links keep working.
 */
export function CustomerJoinFlow({
  restaurant,
  initialService = null,
}: CustomerJoinFlowProps) {
  const isTakeawayEnabled = Boolean(restaurant.takeawayEnabled);

  // null  → selector screen (no choice yet)
  // 'DINE_IN' | 'TAKEAWAY' → form screen
  const [selectedService, setSelectedService] = useState<'DINE_IN' | 'TAKEAWAY' | null>(
    isTakeawayEnabled ? initialService : 'DINE_IN',
  );

  // Takeaway disabled → classic Dine-In form, no selector at all.
  if (!isTakeawayEnabled) {
    return <QueueJoinForm restaurant={restaurant} />;
  }

  // Both services available but nothing chosen yet → selector only.
  if (selectedService === null) {
    return (
      <ServiceSelector
        selectedService={null}
        onSelectService={setSelectedService}
      />
    );
  }

  // A service was chosen → show its join form with a back link.
  return (
    <div className="space-y-3">
      {/* Back to selector */}
      <button
        type="button"
        onClick={() => setSelectedService(null)}
        className="flex items-center gap-1.5 rounded-xl px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 transition-colors active:scale-95 cursor-pointer"
        aria-label="Back to service selection"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Change service
      </button>

      {selectedService === 'DINE_IN' ? (
        <QueueJoinForm restaurant={restaurant} />
      ) : (
        <TakeawayJoinCard restaurant={restaurant} />
      )}
    </div>
  );
}

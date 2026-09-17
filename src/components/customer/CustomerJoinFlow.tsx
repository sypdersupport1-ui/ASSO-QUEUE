'use client';

import React, { useState } from 'react';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { ServiceSelector } from './ServiceSelector';
import { QueueJoinForm } from './QueueJoinForm';
import { TakeawayJoinCard } from './TakeawayJoinCard';

interface CustomerJoinFlowProps {
  restaurant: PublicRestaurantInfo;
  initialService?: 'DINE_IN' | 'TAKEAWAY';
}

/**
 * Phase 2 — Unified Customer Join Flow.
 *
 * Invariant: If takeaway is disabled on the restaurant, this renders the
 * classic Dine-In QueueJoinForm with ZERO extra steps or tabs.
 *
 * If takeaway is enabled, the customer sees the clean ServiceSelector
 * and toggles seamlessly between Dine-In and Takeaway without page reloads.
 */
export function CustomerJoinFlow({
  restaurant,
  initialService = 'DINE_IN',
}: CustomerJoinFlowProps) {
  const isTakeawayEnabled = Boolean(restaurant.takeawayEnabled);
  const [selectedService, setSelectedService] = useState<'DINE_IN' | 'TAKEAWAY'>(
    isTakeawayEnabled ? initialService : 'DINE_IN'
  );

  // When takeaway is disabled, behave 100% identically to existing Dine-In
  if (!isTakeawayEnabled) {
    return <QueueJoinForm restaurant={restaurant} />;
  }

  return (
    <div className="space-y-4">
      <ServiceSelector
        selectedService={selectedService}
        onSelectService={setSelectedService}
      />

      {selectedService === 'DINE_IN' ? (
        <QueueJoinForm restaurant={restaurant} />
      ) : (
        <TakeawayJoinCard restaurant={restaurant} />
      )}
    </div>
  );
}

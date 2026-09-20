import React from 'react';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';
import { CustomerBadge } from './ui/CustomerBadge';

interface RestaurantHeaderProps {
  restaurant: PublicRestaurantInfo;
  waitingCount?: number;
}

/**
 * Customer Restaurant Brand Header.
 * Hospitality identity presentation:
 * Logo or monogram, restaurant name, live queue status, and location.
 * Preserves 100% authoritative data without fabricating slogans or attributes.
 */
export function RestaurantHeader({ restaurant, waitingCount }: RestaurantHeaderProps) {
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  const state = restaurant.queueOperatingState || 'OPEN';
  const isQueueLive = restaurant.queueEnabled && state !== 'CLOSED';

  let statusLabel = 'Queue Open';
  let badgeVariant: 'success' | 'warning' | 'neutral' | 'danger' = 'success';

  if (!restaurant.queueEnabled || state === 'CLOSED') {
    statusLabel = 'Queue Closed';
    badgeVariant = 'neutral';
  } else if (state === 'PAUSED') {
    statusLabel = 'Queue Paused';
    badgeVariant = 'warning';
  } else if (state === 'CLOSING_SOON') {
    statusLabel = 'Closing Soon';
    badgeVariant = 'warning';
  } else if (waitingCount !== undefined) {
    statusLabel = waitingCount === 0 ? 'No wait right now' : `${waitingCount} ${waitingCount === 1 ? 'party' : 'parties'} waiting`;
    badgeVariant = 'success';
  }

  return (
    <header className="flex items-center gap-3.5 py-2 text-left">
      {/* Restaurant Monogram or Logo */}
      <div className="relative shrink-0">
        {restaurant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.logoUrl}
            alt={`${restaurant.name} logo`}
            className="h-12 w-12 rounded-2xl border border-white/10 object-cover shadow-md shadow-black/20"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.12] bg-gradient-to-br from-[#1c263b] to-[#121826] text-base font-black text-white shadow-md shadow-black/25 tracking-wider"
          >
            {getInitials(restaurant.name)}
          </div>
        )}
      </div>

      {/* Brand Name & Live Status */}
      <div className="min-w-0 flex-1">
        <h1 className="line-clamp-2 text-lg sm:text-xl font-black tracking-tight text-white leading-tight break-words">
          {restaurant.name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <CustomerBadge variant={badgeVariant} pulse={isQueueLive}>
            {statusLabel}
          </CustomerBadge>
          {restaurant.address && (
            <span className="truncate text-slate-400 text-xs max-w-[180px] sm:max-w-xs">
              {restaurant.address}{restaurant.city ? `, ${restaurant.city}` : ''}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}


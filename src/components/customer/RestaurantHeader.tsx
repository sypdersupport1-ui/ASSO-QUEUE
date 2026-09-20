import React from 'react';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';

interface RestaurantHeaderProps {
  restaurant: PublicRestaurantInfo;
  waitingCount?: number;
}

/**
 * Restaurant Identity Level 2: Restaurant Hero
 *
 * Requirements:
 * - Restaurant NAME only
 * - No restaurant logo requirement / no monogram
 * - Optional tagline from restaurant description
 * - Strong visual prominence with safe wrapping
 * - Compact vertical footprint to keep queue status & service tiles above the fold
 */
export function RestaurantHeader({ restaurant, waitingCount }: RestaurantHeaderProps) {
  return (
    <header className="text-center pt-2 pb-1.5 space-y-1">
      <h1 className="line-clamp-2 break-words text-2xl sm:text-3xl font-black uppercase tracking-tight text-white leading-tight px-2">
        {restaurant.name}
      </h1>
      {restaurant.description && (
        <p className="text-xs sm:text-sm font-medium text-slate-300 max-w-sm mx-auto leading-snug px-3 line-clamp-2">
          {restaurant.description}
        </p>
      )}
      {waitingCount !== undefined && (
        <span className="sr-only">
          {waitingCount === 0 ? 'No wait right now' : `${waitingCount} ${waitingCount === 1 ? 'party' : 'parties'} waiting`}
        </span>
      )}
    </header>
  );
}


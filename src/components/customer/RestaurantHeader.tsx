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
 * - Restaurant NAME in elegant luxury serif display treatment (Playfair / Cormorant / Georgia)
 * - Warm ivory / soft champagne tone (#fff9f0) with subtle warm glow
 * - Slightly increased letter spacing (tracking-[0.06em])
 * - Sophisticated capitalization, no heavy cartoonish sans-serif
 * - Tagline: elegant smaller text, warm ivory/champagne, increased letter spacing (tracking-[0.14em])
 * - Compact vertical footprint to keep queue status & service tiles above the fold
 */
export function RestaurantHeader({ restaurant, waitingCount }: RestaurantHeaderProps) {
  return (
    <header className="text-center pt-2 pb-1.5 space-y-1.5">
      <h1 className="font-luxury-serif line-clamp-2 break-words text-3xl sm:text-4xl font-normal tracking-[0.06em] uppercase text-[#fff9f0] leading-tight px-2 drop-shadow-[0_2px_14px_rgba(245,158,11,0.20)]">
        {restaurant.name}
      </h1>
      {restaurant.description && (
        <p className="text-xs sm:text-[13px] font-normal tracking-[0.14em] uppercase text-[#edd7be]/90 max-w-sm mx-auto leading-relaxed px-3 line-clamp-2">
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


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
    <header className="text-center pt-1.5 pb-1 space-y-1">
      <h1 className="font-luxury-serif line-clamp-2 break-words text-2xl sm:text-3xl font-semibold tracking-[0.04em] uppercase text-[#fff9f0] leading-tight px-2 drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
        {restaurant.name}
      </h1>
      {restaurant.description && (
        <p className="text-xs sm:text-[12.5px] font-normal tracking-[0.08em] text-slate-300/85 max-w-sm mx-auto leading-relaxed px-3 line-clamp-2">
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


import React from 'react';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';

interface RestaurantHeaderProps {
  restaurant: PublicRestaurantInfo;
  waitingCount?: number;
}

/**
 * Phase 4A — Customer restaurant header.
 * Answers "Where am I?" in ~1 second: logo, name, location, live status.
 * Decorative glow elements are aria-hidden; status pill carries text
 * (never color-only).
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
  const statusLabel = !restaurant.queueEnabled || state === 'CLOSED'
    ? 'Queue closed'
    : state === 'PAUSED'
      ? 'Queue paused'
      : state === 'CLOSING_SOON'
        ? 'Closing soon'
        : waitingCount !== undefined
          ? `${waitingCount} ${waitingCount === 1 ? 'party' : 'parties'} · Live`
          : 'Queue open';

  return (
    <header className="flex items-center gap-3 py-3 text-left">
      <div className="relative shrink-0">
        {restaurant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.logoUrl}
            alt={`${restaurant.name} logo`}
            className="h-12 w-12 rounded-2xl border border-white/10 object-cover shadow-sm"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 border border-white/10 text-base font-black text-white shadow-sm"
          >
            {getInitials(restaurant.name)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg sm:text-xl font-black tracking-tight text-white leading-tight">
          {restaurant.name}
        </h1>
        <div className="mt-0.5 flex items-center gap-2 text-xs">
          <span
            role="status"
            className="inline-flex items-center gap-1.5 font-bold text-emerald-400"
          >
            {restaurant.queueEnabled && state !== 'CLOSED' && (
              <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
            )}
            {statusLabel}
          </span>
          {restaurant.address && (
            <>
              <span className="text-slate-600">·</span>
              <span className="truncate text-slate-400 text-[11px]">
                {restaurant.address}{restaurant.city ? `, ${restaurant.city}` : ''}
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { UtensilsCrossed, ArrowRight } from 'lucide-react';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  available?: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

interface KitchenPreOrderCardProps {
  queueNumber: string;
  restaurantSlug: string;
  token?: string;
  categories?: MenuCategory[];
}

export function KitchenPreOrderCard({
  restaurantSlug,
  token,
  categories = [],
}: KitchenPreOrderCardProps) {
  const menuUrl = token ? `/q/${restaurantSlug}/menu?qtoken=${token}` : `/q/${restaurantSlug}/menu`;
  const firstItem = categories.flatMap((c) => c.items).find((i) => i.available !== false);

  return (
    <Link
      href={menuUrl}
      className="customer-glass-card group flex items-center justify-between gap-3 p-3.5 sm:p-4 transition-all hover:bg-white/[0.06] active:scale-[0.99] shadow-sm rounded-2xl"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--qf-primary)]/15 text-[var(--qf-primary)] border border-white/5">
          <UtensilsCrossed className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-bold text-white group-hover:text-[var(--qf-primary)] transition-colors truncate">
            Browse Menu &amp; Pre-Order
          </p>
          <p className="truncate text-[11px] text-slate-400">
            {firstItem ? `Order ahead · e.g. ${firstItem.name}` : 'Explore dishes to be served upon seating'}
          </p>
        </div>
      </div>

      <span className="shrink-0 text-xs font-bold text-[var(--qf-primary)] group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
        <span>Menu</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}


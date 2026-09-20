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
      className="customer-glass-card group block p-3.5 transition-all hover:bg-white/[0.06] active:scale-[0.99] shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--qf-primary)]/15 text-[var(--qf-primary)] border border-[var(--qf-border)] shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white group-hover:text-[var(--qf-primary)] transition-colors">
              Hungry while you wait?
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {firstItem ? `Browse menu · e.g. ${firstItem.name}` : 'Browse menu & pre-order →'}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-bold text-[var(--qf-primary)] group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
          Menu <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}


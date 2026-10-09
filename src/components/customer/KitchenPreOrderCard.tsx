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
  const sampleCategories = categories.filter((c) => c.items && c.items.length > 0).slice(0, 3);

  return (
    <Link
      href={menuUrl}
      className="customer-glass-card group block p-4 transition-all hover:bg-white/[0.06] active:scale-[0.99] shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--qf-primary)]/15 text-[var(--qf-primary)] border border-[var(--qf-border)] shadow-sm group-hover:scale-105 transition-transform">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-xs sm:text-sm font-bold text-white group-hover:text-[var(--qf-primary)] transition-colors">
                Hungry while you wait?
              </p>
              <span className="rounded-full bg-[var(--qf-primary)]/20 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider text-[var(--qf-primary)]">
                Pre-Order
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-400">
              {firstItem ? `Browse kitchen menu · e.g. ${firstItem.name}` : 'Explore dishes & order ahead for your table'}
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1 text-xs font-black text-[var(--qf-primary)] group-hover:translate-x-0.5 transition-transform">
          <span>View Menu</span>
          <ArrowRight className="h-4 w-4" />
        </div>
      </div>

      {sampleCategories.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-white/5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">Categories:</span>
          {sampleCategories.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10.5px] font-medium text-slate-300"
            >
              {c.name}
            </span>
          ))}
          {categories.length > 3 && (
            <span className="text-[10px] text-slate-500 font-semibold">+{categories.length - 3} more</span>
          )}
        </div>
      )}
    </Link>
  );
}


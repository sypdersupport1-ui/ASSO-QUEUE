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
      className="group block rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-slate-900/40 to-slate-900/60 p-3.5 transition-all hover:border-emerald-500/40 hover:from-emerald-500/15 active:scale-[0.99] shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white group-hover:text-emerald-200 transition-colors">
              Hungry while you wait?
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {firstItem ? `Browse menu · e.g. ${firstItem.name}` : 'Browse menu & pre-order →'}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
          Menu <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}


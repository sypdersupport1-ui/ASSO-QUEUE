import React from 'react';
import Link from 'next/link';
import { UtensilsCrossed, ChevronRight, Sparkles } from 'lucide-react';
import type { MenuPreviewCategory } from './MenuPreviewSection';

interface SignatureDishesCardProps {
  slug: string;
  categories: MenuPreviewCategory[];
}

/**
 * Canonical Signature Dishes / Menu Entry Card
 *
 * Requirements:
 * - Replaces generic oversized menu preview with a compact premium discovery card
 * - Structure: [food image] Our Signature Dishes / Explore our menu →
 * - Uses real menu imagery when available
 * - Graceful culinary fallback when no images exist
 * - Direct link to full digital menu /q/[slug]/menu
 */
export function SignatureDishesCard({ slug, categories }: SignatureDishesCardProps) {
  // Find lead image from authoritative real menu data if available
  const allItems = categories.flatMap((c) => c.items || []);
  const leadItem = allItems.find((item) => Boolean((item as { image_url?: string | null }).image_url));
  const leadImageUrl = (leadItem as { image_url?: string | null } | undefined)?.image_url ?? null;

  return (
    <Link
      href={`/q/${slug}/menu`}
      className="customer-glass-card group flex items-center gap-3.5 p-3.5 sm:p-4 transition-all hover:border-[var(--qf-border-hover)] hover:bg-white/[0.06] active:scale-[0.99] text-left block"
      aria-label="Explore our menu and signature dishes"
    >
      <div className="relative h-13 w-13 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {leadImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={leadImageUrl}
            alt="Signature Dishes"
            className="h-full w-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--qf-primary)] bg-[var(--qf-primary-glow)]">
            <UtensilsCrossed className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-[var(--qf-primary)] shrink-0" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--qf-primary)]">
            Chef Selection
          </span>
        </div>
        <h3 className="text-sm sm:text-base font-black text-white tracking-tight truncate mt-0.5">
          Our Signature Dishes
        </h3>
        <p className="text-[11px] text-[var(--qf-text-secondary)] truncate mt-0.5">
          Explore our menu
        </p>
      </div>

      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 group-hover:text-white group-hover:border-[var(--qf-primary)]/40 group-hover:translate-x-0.5 transition-all">
        <ChevronRight className="h-4 w-4 text-[var(--qf-primary)]" aria-hidden="true" />
      </div>
    </Link>
  );
}

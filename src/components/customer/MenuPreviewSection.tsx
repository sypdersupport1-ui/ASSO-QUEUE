import React from 'react';
import { UtensilsCrossed, Sparkles } from 'lucide-react';

export interface MenuPreviewCategory {
  id: string;
  name: string;
  description: string | null;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    available: boolean;
  }>;
}

interface MenuPreviewSectionProps {
  categories: MenuPreviewCategory[];
  currency?: string;
}

export function MenuPreviewSection({ categories, currency = 'INR' }: MenuPreviewSectionProps) {
  if (!categories || categories.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#121826]/80 p-6 text-center space-y-2.5">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400">
          <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-white">Menu Preview</p>
          <p className="text-xs text-slate-400">Full menu available when browsing the digital menu</p>
        </div>
      </div>
    );
  }

  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const formatPrice = (price: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'INR',
        maximumFractionDigits: 2,
      }).format(price);
    } catch { return `₹${price.toFixed(2)}`; }
  };

  return (
    <div className="rounded-2xl sm:rounded-3xl border border-white/[0.08] bg-[#121826]/80 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-200">
            Menu Highlights
          </h3>
        </div>
        <span className="text-[11px] font-medium text-slate-400">
          A selection from the kitchen
        </span>
      </div>

      <div className="space-y-5">
        {categories.slice(0,3).map((cat) => (
          <div key={cat.id} className="space-y-2.5">
            <h4 className="flex items-center justify-between border-b border-white/10 pb-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-400">
              <span>{cat.name}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono font-bold text-slate-400">{cat.items.length}</span>
            </h4>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {cat.items.slice(0,4).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-all hover:border-emerald-500/30 hover:bg-white/[0.06] active:scale-[0.99]"
                >
                  <div
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] border border-white/10 text-emerald-400 font-black text-xs shadow-sm"
                  >
                    <UtensilsCrossed className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h5 className="truncate text-[13px] font-black text-white">{item.name}</h5>
                    {item.description && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                        {item.description}
                      </p>
                    )}
                  </div>
                  {item.available ? (
                    <span className="shrink-0 rounded-lg bg-emerald-500/15 px-2 py-1 text-xs font-black text-emerald-300">
                      {formatPrice(item.price)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-slate-500/15 border border-slate-400/20 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Unavailable
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

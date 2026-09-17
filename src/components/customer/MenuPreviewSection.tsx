import React from 'react';

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

const FOOD_EMOJI = ['🍛', '🍕', '🍔', '🍜', '🥘', '🍰', '🥗', '🍗', '🌮', '🍝', '🥪', '🍩'];

function emojiFor(name: string, index: number) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FOOD_EMOJI[(h + index) % FOOD_EMOJI.length];
}

export function MenuPreviewSection({ categories, currency = 'INR' }: MenuPreviewSectionProps) {
  if (!categories || categories.length === 0) {
    return (
      <div className="qf-card rounded-3xl p-8 text-center">
        <span aria-hidden="true" className="text-4xl">👨‍🍳</span>
        <p className="mt-2 text-sm font-black text-white">Kitchen is prepping the menu</p>
        <p className="mt-1 text-xs text-slate-400">Ask the host for today&apos;s specials 😋</p>
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
    <div className="qf-card space-y-5 rounded-3xl p-5 sm:p-6">
      <div className="space-y-1 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span> While you wait
        </span>
        <h3 className="qf-keep-dark text-xl font-black tracking-tight text-white">
          Craving something? 😋
        </h3>
        <p className="text-xs text-slate-400">
          A taste of the menu — full spread after you join
        </p>
      </div>

      <div className="space-y-5">
        {categories.slice(0,3).map((cat) => (
          <div key={cat.id} className="space-y-2.5">
            <h4 className="flex items-center justify-between border-b border-white/10 pb-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-400">
              <span>{cat.name}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono font-bold text-slate-400">{cat.items.length}</span>
            </h4>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {cat.items.slice(0,4).map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-all hover:border-emerald-500/30 hover:bg-white/[0.06] active:scale-[0.99]"
                >
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 border border-white/10 text-2xl shadow-sm">
                    {emojiFor(item.name, idx)}
                  </span>
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

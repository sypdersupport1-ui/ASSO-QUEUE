import React from 'react';
import { Bell, Flame, HeartHandshake } from 'lucide-react';

/**
 * Canonical Hospitality Feature Row
 *
 * Requirements:
 * - 3-item compact reassurance row below Join Queue CTA
 * - 1. Live Updates / Real-time status
 * - 2. Authentic Flavours / Memorable moments
 * - 3. Warm Hospitality / Always together
 * - Restrained, compact, hospitality reassurance (not marketing landing page)
 */
export function HospitalityFeatureRow() {
  const items = [
    {
      icon: <Bell className="h-4 w-4 text-[var(--qf-primary)]" />,
      title: 'Live Updates',
      desc: 'Real-time status',
    },
    {
      icon: <Flame className="h-4 w-4 text-amber-400" />,
      title: 'Authentic Flavours',
      desc: 'Memorable moments',
    },
    {
      icon: <HeartHandshake className="h-4 w-4 text-rose-400" />,
      title: 'Warm Hospitality',
      desc: 'Always together',
    },
  ];

  return (
    <div
      role="region"
      aria-label="Hospitality promises"
      className="grid grid-cols-3 gap-2 sm:gap-2.5 pt-1"
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          className="customer-glass-surface p-2.5 sm:p-3 text-center flex flex-col items-center justify-center rounded-2xl space-y-1 select-none"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] border border-white/10 shrink-0">
            {item.icon}
          </div>
          <div className="min-w-0 w-full">
            <p className="text-[11px] sm:text-xs font-black tracking-tight text-white truncate">
              {item.title}
            </p>
            <p className="text-[9.5px] sm:text-[10px] text-slate-400 leading-tight truncate">
              {item.desc}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

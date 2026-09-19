import React from 'react';

interface CustomerBadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'info' | 'neutral' | 'danger';
  pulse?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

/**
 * Reusable CustomerBadge primitive.
 * High-contrast, semantic status pill with optional pulsating live dot.
 */
export function CustomerBadge({
  children,
  variant = 'success',
  pulse = false,
  className = '',
  icon,
}: CustomerBadgeProps) {
  const variantStyles = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    info: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    neutral: 'border-white/10 bg-white/[0.04] text-slate-300',
    danger: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
  };

  const dotColors = {
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    info: 'bg-blue-400',
    neutral: 'bg-slate-400',
    danger: 'bg-rose-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${variantStyles[variant]} ${className}`}
    >
      {pulse ? (
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColors[variant]} opacity-75`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColors[variant]}`} />
        </span>
      ) : icon ? (
        <span aria-hidden="true" className="shrink-0">{icon}</span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}

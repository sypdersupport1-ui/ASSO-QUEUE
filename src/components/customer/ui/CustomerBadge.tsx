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
    success: 'border-[var(--qf-success)]/30 bg-[var(--qf-success)]/10 text-[var(--qf-success)]',
    warning: 'border-[var(--qf-warning)]/30 bg-[var(--qf-warning)]/10 text-[var(--qf-warning)]',
    info: 'border-[var(--qf-accent-dine-in)]/30 bg-[var(--qf-accent-dine-in)]/10 text-[var(--qf-accent-dine-in)]',
    neutral: 'border-[var(--qf-border)] bg-white/[0.04] text-slate-300',
    danger: 'border-[var(--qf-danger)]/30 bg-[var(--qf-danger)]/10 text-[var(--qf-danger)]',
  };

  const dotColors = {
    success: 'bg-[var(--qf-success)]',
    warning: 'bg-[var(--qf-warning)]',
    info: 'bg-[var(--qf-accent-dine-in)]',
    neutral: 'bg-slate-400',
    danger: 'bg-[var(--qf-danger)]',
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

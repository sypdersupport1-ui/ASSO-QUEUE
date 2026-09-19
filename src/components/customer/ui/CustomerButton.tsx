import React from 'react';
import { LoaderCircle } from 'lucide-react';

interface CustomerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'takeaway' | 'dine_in' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'default' | 'lg';
  isLoading?: boolean;
  loadingText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Reusable CustomerButton primitive.
 * Tactile touch targets (>= 48px on mobile), clear accessible focus rings,
 * and distinct hospitality color accents for Dine-In vs Takeaway.
 */
export function CustomerButton({
  variant = 'primary',
  size = 'default',
  isLoading = false,
  loadingText,
  leftIcon,
  rightIcon,
  children,
  className = '',
  disabled,
  ...props
}: CustomerButtonProps) {
  const baseStyles =
    'relative inline-flex items-center justify-center font-bold tracking-tight rounded-2xl transition-all select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';

  const sizeStyles = {
    sm: 'h-10 min-h-[40px] px-3.5 text-xs gap-1.5',
    default: 'h-12 min-h-[48px] px-4 text-sm gap-2',
    lg: 'h-13 min-h-[52px] px-5 text-sm sm:text-base gap-2.5',
  };

  const variantStyles = {
    primary:
      'bg-[var(--qf-primary)] hover:bg-[var(--qf-primary-hover)] text-[var(--qf-primary-foreground)] font-black shadow-lg shadow-emerald-500/15 focus-visible:ring-[var(--qf-primary)]',
    takeaway:
      'bg-[var(--qf-accent-takeaway)] hover:opacity-95 text-slate-950 font-black shadow-lg shadow-amber-500/15 focus-visible:ring-[var(--qf-accent-takeaway)]',
    dine_in:
      'bg-[var(--qf-accent-dine-in)] hover:opacity-95 text-white font-black shadow-lg shadow-blue-600/15 focus-visible:ring-[var(--qf-accent-dine-in)]',
    secondary:
      'border border-[var(--qf-border)] bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 hover:text-white focus-visible:ring-slate-400',
    danger:
      'border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 focus-visible:ring-rose-400',
    ghost:
      'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] focus-visible:ring-slate-400',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <>
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin shrink-0" />
          <span role="status">{loadingText || 'Loading...'}</span>
        </>
      ) : (
        <>
          {leftIcon && <span aria-hidden="true" className="shrink-0">{leftIcon}</span>}
          <span>{children}</span>
          {rightIcon && <span aria-hidden="true" className="shrink-0">{rightIcon}</span>}
        </>
      )}
    </button>
  );
}

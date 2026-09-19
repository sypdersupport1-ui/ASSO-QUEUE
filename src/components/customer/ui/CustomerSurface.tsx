import React from 'react';

interface CustomerSurfaceProps {
  children: React.ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  variant?: 'card' | 'elevated' | 'subtle' | 'interactive';
  'aria-label'?: string;
  role?: string;
}

/**
 * Reusable CustomerSurface primitive.
 * Elegant hospitality surface with refined borders, subtle elevation,
 * and semantic design token mapping.
 */
export function CustomerSurface({
  children,
  className = '',
  as: Component = 'section',
  variant = 'card',
  'aria-label': ariaLabel,
  role,
}: CustomerSurfaceProps) {
  const variantStyles = {
    card: 'border border-[var(--qf-border)] bg-[var(--qf-surface)] shadow-[var(--qf-shadow-md)] backdrop-blur-md rounded-2xl sm:rounded-3xl',
    elevated: 'border border-[var(--qf-border-hover)] bg-[var(--qf-surface-elevated)] shadow-[var(--qf-shadow-lg)] rounded-2xl sm:rounded-3xl',
    subtle: 'border border-[var(--qf-border-subtle)] bg-white/[0.02] rounded-xl sm:rounded-2xl',
    interactive: 'border border-[var(--qf-border)] bg-[var(--qf-surface-interactive)] hover:border-[var(--qf-border-hover)] transition-all rounded-2xl cursor-pointer active:scale-[0.99]',
  };

  return (
    <Component
      aria-label={ariaLabel}
      role={role}
      className={`relative ${variantStyles[variant]} p-4 sm:p-5 text-slate-100 ${className}`}
    >
      {children}
    </Component>
  );
}

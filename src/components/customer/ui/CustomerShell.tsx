import React from 'react';
import type { CustomerTheme } from '@/lib/themes/types';
import { themeToCssVariables } from '@/lib/themes/resolver';
import { ThemeArtwork } from '@/components/themes';

interface CustomerShellProps {
  children: React.ReactNode;
  className?: string;
  as?: 'main' | 'div';
  theme?: CustomerTheme | null;
  style?: React.CSSProperties;
  id?: string;
}

/**
 * Reusable CustomerShell primitive.
 * Provides consistent mobile-first container, safe area padding,
 * warm ambient restaurant backdrop, and canonical customer theme CSS variable injection.
 */
export function CustomerShell({
  children,
  className = '',
  as: Component = 'main',
  theme,
  style,
  id,
}: CustomerShellProps) {
  const themeStyles = theme ? themeToCssVariables(theme) : undefined;

  return (
    <Component
      id={id}
      data-theme={theme?.key || 'default'}
      style={{
        ...themeStyles,
        ...style,
      }}
      className={`qf-bg relative flex min-h-[100dvh] flex-col justify-between overflow-x-hidden text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-100 ${className}`}
    >
      {/* Subtle ambient lighting with low opacity */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-gradient-to-b from-slate-800/25 via-slate-900/10 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full blur-3xl opacity-60"
        style={{ background: 'var(--qf-primary-glow)' }}
      />

      {/* Theme Decorative Motif & Artwork Layer */}
      <ThemeArtwork theme={theme} variant="page" />

      {/* Main content column with mobile-optimized padding & safe area handling */}
      <div className="relative z-10 mx-auto w-full max-w-md flex-1 space-y-4 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 sm:py-7">
        {children}
      </div>

      {/* Shared refined hospitality footer with safe area bottom inset */}
      <footer className="relative z-10 mx-auto w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-center">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span>Powered by</span>
          <span className="font-bold tracking-tight text-[var(--qf-primary)]">QueueFlow</span>
        </p>
      </footer>
    </Component>
  );
}

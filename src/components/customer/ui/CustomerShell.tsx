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
 *
 * When the active theme includes `artwork.backgroundImage`, a full-bleed photo
 * background is rendered beneath a translucent scrim so the artwork remains
 * visible without sacrificing content legibility.
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
  const bgImage = theme?.artwork?.backgroundImage ?? null;

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
      {/* ── Theme background image layer (when present) ─────────────────────── */}
      {bgImage && (
        <>
          {/* Full-bleed photo — fixed so it doesn't scroll away on long pages */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgImage}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
            className="pointer-events-none fixed inset-0 h-full w-full object-cover object-center z-0 select-none"
            style={{ zIndex: 0 }}
          />
          {/* Translucent scrim: preserves the artwork atmosphere while ensuring
              text / card contrast. Gradient darkens toward top and bottom edges
              (where header and footer live) while keeping centre more open. */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[1]"
            style={{
              background: `
                linear-gradient(
                  to bottom,
                  rgba(20, 6, 0, 0.55) 0%,
                  rgba(20, 6, 0, 0.20) 30%,
                  rgba(20, 6, 0, 0.20) 70%,
                  rgba(20, 6, 0, 0.60) 100%
                )
              `,
            }}
          />
        </>
      )}

      {/* ── Default ambient lighting (used when no photo background) ─────────── */}
      {!bgImage && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-gradient-to-b from-slate-800/25 via-slate-900/10 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full blur-3xl opacity-60"
            style={{ background: 'var(--qf-primary-glow)' }}
          />
        </>
      )}

      {/* Theme Decorative Motif & Artwork Layer (z-index above scrim when bgImage present) */}
      <div className={bgImage ? 'relative z-[2]' : ''}>
        <ThemeArtwork theme={theme} variant="page" />
      </div>

      {/* Main content column with mobile-optimized padding & safe area handling */}
      <div className="relative mx-auto w-full max-w-md flex-1 space-y-4 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 sm:py-7"
        style={{ zIndex: bgImage ? 10 : undefined }}
      >
        {children}
      </div>

      {/* Shared refined hospitality footer with safe area bottom inset */}
      <footer
        className="relative mx-auto w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-center"
        style={{ zIndex: bgImage ? 10 : undefined }}
      >
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span>Powered by</span>
          <span className="font-bold tracking-tight text-[var(--qf-primary)]">QueueFlow</span>
        </p>
      </footer>
    </Component>
  );
}

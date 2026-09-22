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
  hideFooter?: boolean;
}

/**
 * Reusable CustomerShell primitive.
 * Implements the canonical 5-layer visual architecture:
 *   Layer 1: Theme Background (local photo, local SVG, or neutral hospitality ambient)
 *   Layer 2: Readability Scrim (theme-aware or custom translucent scrim)
 *   Layer 3: Theme Motif & Decorative Artwork
 *   Layer 4: Customer Content (mobile-first 375–393px optimized, safe area insets)
 *   Layer 5: Glass Surfaces & Accents (controlled hospitality glass)
 */
export function CustomerShell({
  children,
  className = '',
  as: Component = 'main',
  theme,
  style,
  id,
  hideFooter = false,
}: CustomerShellProps) {
  const themeStyles = theme ? themeToCssVariables(theme) : undefined;
  const bgImage = theme?.artwork?.backgroundImage ?? null;
  const cssBackground = theme?.artwork?.cssBackground ?? null;

  // Configurable theme-aware scrim: theme-specific override, or fallback hospitality scrim
  const scrimGradient =
    theme?.artwork?.scrim ||
    `linear-gradient(
      to bottom,
      rgba(10, 14, 22, 0.72) 0%,
      rgba(10, 14, 22, 0.28) 25%,
      rgba(10, 14, 22, 0.28) 70%,
      rgba(10, 14, 22, 0.85) 100%
    )`;

  return (
    <Component
      id={id}
      data-theme={theme?.key || 'default'}
      style={{
        ...themeStyles,
        ...style,
      }}
      className={`qf-bg relative flex min-h-[100dvh] flex-col justify-between overflow-x-hidden text-slate-100 selection:bg-[var(--qf-primary)]/30 selection:text-[var(--qf-primary-foreground)] ${className}`}
    >
      {/* ── Layer 1 & 2: Theme Background & Scrim ───────────────────────────── */}
      {bgImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgImage}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
            className="pointer-events-none fixed inset-0 h-full w-full object-cover object-center select-none"
            style={{ zIndex: 0 }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0"
            style={{
              zIndex: 1,
              background: scrimGradient,
            }}
          />
        </>
      ) : cssBackground ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 select-none"
            style={{
              zIndex: 0,
              background: cssBackground,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0"
            style={{
              zIndex: 1,
              background: scrimGradient,
            }}
          />
        </>
      ) : (
        <>
          {/* Neutral premium hospitality ambient backdrop */}
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

      {/* ── Layer 3: Theme Decorative Motif & Artwork ────────────────────────── */}
      <div className={bgImage || cssBackground ? 'relative z-[2]' : ''}>
        <ThemeArtwork theme={theme} variant="page" />
      </div>

      {/* ── Layer 4: Main Content Column (Mobile First) ──────────────────────── */}
      <div
        className="relative mx-auto w-full max-w-md flex-1 space-y-3.5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 sm:py-6"
        style={{ zIndex: bgImage || cssBackground ? 10 : undefined }}
      >
        {children}
      </div>

      {/* ── Layer 5: Branded Hospitality Footer ──────────────────────────────── */}
      {!hideFooter && (
        <footer
          className="relative z-0 mx-auto w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-center space-y-1 select-none pointer-events-none"
        >
          <div aria-hidden="true" className="flex justify-center text-amber-400/70 text-xs select-none">
            ✦
          </div>
          <p className="text-xs font-serif italic text-slate-300 tracking-wide select-none">
            Food Brings Us Closer
          </p>
          <p className="inline-flex items-center gap-1.5 text-[10px] font-medium text-slate-500 pt-0.5">
            <span>Powered by</span>
            <span className="font-bold tracking-tight text-[var(--qf-primary)]">QueueFlow</span>
          </p>
        </footer>
      )}
    </Component>
  );
}

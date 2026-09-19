import React from 'react';
import type { CustomerTheme } from './types';
import { DEFAULT_CUSTOMER_THEME } from './default-theme';
import { THEME_REGISTRY } from './registry';

/**
 * Single Authoritative Customer Theme Resolver.
 *
 * Resolves an active CustomerTheme given a persisted or requested theme key.
 *
 * Rules:
 * 1. If key is null, undefined, whitespace, or unknown -> falls back to DEFAULT_CUSTOMER_THEME.
 * 2. If key exists in THEME_REGISTRY -> returns the canonical registered theme.
 * 3. Future-proof: Designed to receive schedule overrides in Phase 5 without changing
 *    customer component signatures.
 */
export function resolveCustomerTheme(themeKey?: string | null): CustomerTheme {
  if (!themeKey || typeof themeKey !== 'string') {
    return DEFAULT_CUSTOMER_THEME;
  }

  const normalized = themeKey.trim().toLowerCase();
  const theme = THEME_REGISTRY[normalized];

  if (!theme) {
    return DEFAULT_CUSTOMER_THEME;
  }

  return theme;
}

/**
 * Converts a validated CustomerTheme into CSS custom properties (--qf-*).
 * Injected at the server root or CustomerShell boundary.
 *
 * Security: Only reads tokens from registered, static CustomerTheme objects.
 * Arbitrary user-supplied CSS strings are never passed through.
 */
export function themeToCssVariables(theme?: CustomerTheme | null): React.CSSProperties {
  const active = theme || DEFAULT_CUSTOMER_THEME;
  const { surfaces, accents, text, borders, status, geometry } = active.tokens;

  return {
    '--qf-background': surfaces.background,
    '--qf-background-elevated': surfaces.backgroundElevated,
    '--qf-surface': surfaces.surface,
    '--qf-surface-solid': surfaces.surfaceSolid,
    '--qf-surface-elevated': surfaces.surfaceElevated,
    '--qf-surface-interactive': surfaces.surfaceInteractive,

    '--qf-primary': accents.primary,
    '--qf-primary-hover': accents.primaryHover,
    '--qf-primary-foreground': accents.primaryForeground,
    '--qf-primary-glow': accents.primaryGlow,
    '--qf-accent-dine-in': accents.accentDineIn,
    '--qf-accent-dine-in-glow': accents.accentDineInGlow,
    '--qf-accent-takeaway': accents.accentTakeaway,
    '--qf-accent-takeaway-glow': accents.accentTakeawayGlow,

    '--qf-text': text.text,
    '--qf-text-secondary': text.textSecondary,
    '--qf-text-muted': text.textMuted,

    '--qf-border': borders.border,
    '--qf-border-subtle': borders.borderSubtle,
    '--qf-border-hover': borders.borderHover,
    '--qf-border-active': borders.borderActive,

    '--qf-success': status.success,
    '--qf-warning': status.warning,
    '--qf-danger': status.danger,

    '--qf-radius-sm': geometry.radiusSm,
    '--qf-radius-md': geometry.radiusMd,
    '--qf-radius-lg': geometry.radiusLg,
    '--qf-radius-xl': geometry.radiusXl,

    '--qf-shadow-sm': geometry.shadowSm,
    '--qf-shadow-md': geometry.shadowMd,
    '--qf-shadow-lg': geometry.shadowLg,
  } as React.CSSProperties;
}

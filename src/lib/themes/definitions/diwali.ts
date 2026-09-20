import type { CustomerTheme } from '../types';

/**
 * Diwali Festival Theme — Premium Hospitality Edition.
 *
 * Visual Direction:
 * Based on the approved Diwali reference asset:
 *   - Deep maroon/mahogany shadow regions (#140602 / #1c0c05)
 *   - Warm golden lighting & molten brass glow
 *   - Traditional rangoli / mandala artwork
 *   - Hanging brass diya lamps & glowing flame highlights
 *   - Soft bokeh light particles
 *   - Dark central negative space for UI readability
 *
 * Architecture:
 * 1. Background: High-resolution optimized portrait asset (/themes/diwali-bg.jpg)
 * 2. Readability Scrim: Custom warm maroon-tinted gradient preserving decorative edges
 * 3. Glass Surfaces: Dark translucent warm-brown glass with controlled blur
 * 4. Accents: Warm burnished gold / amber CTA and status highlights (high contrast, zero neon)
 * 5. Motif: Subtle rangoli overlay at restrained opacity for secondary surfaces
 */
export const DIWALI_THEME: CustomerTheme = {
  key: 'diwali',
  name: 'Diwali',
  description:
    'Immersive Diwali festival atmosphere — glowing diyas, gold mandala rangoli, and warm amber bokeh set against a deep mahogany backdrop.',
  tokens: {
    surfaces: {
      background: '#140602',
      backgroundElevated: '#1f0a04',
      surface: 'rgba(26, 11, 5, 0.82)',
      surfaceSolid: '#1c0c05',
      surfaceElevated: 'rgba(38, 16, 7, 0.90)',
      surfaceInteractive: '#341608',
    },
    accents: {
      primary: '#f59e0b',
      primaryHover: '#d97706',
      primaryForeground: '#140602',
      primaryGlow: 'rgba(245, 158, 11, 0.20)',
      accentDineIn: '#c2410c',
      accentDineInGlow: 'rgba(194, 65, 12, 0.20)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.20)',
    },
    text: {
      text: '#fff9f0',
      textSecondary: '#edd7be',
      textMuted: '#ba9a76',
    },
    borders: {
      border: 'rgba(234, 179, 8, 0.18)',
      borderSubtle: 'rgba(234, 179, 8, 0.08)',
      borderHover: 'rgba(234, 179, 8, 0.36)',
      borderActive: 'rgba(234, 179, 8, 0.55)',
    },
    status: {
      success: '#22c55e',
      warning: '#f59e0b',
      danger: '#ef4444',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(0, 0, 0, 0.45)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.55)',
      shadowLg: '0 16px 48px rgba(0, 0, 0, 0.65)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['diwali', 'festival', 'diya', 'gold', 'rangoli', 'mandala', 'amber', 'mahogany'],
    previewAccentColor: '#e6a122',
    previewSurfaceColor: '#1c0c05',
  },
  artwork: {
    motif: 'diwali-rangoli',
    opacity: 0.05,
    placement: 'top-split',
    backgroundImage: '/themes/diwali-bg.jpg',
    scrim:
      'linear-gradient(to bottom, rgba(20, 7, 3, 0.65) 0%, rgba(20, 7, 3, 0.20) 22%, rgba(20, 7, 3, 0.12) 50%, rgba(20, 7, 3, 0.35) 80%, rgba(14, 5, 2, 0.78) 100%)',
  },
};

import type { CustomerTheme } from '../types';

/**
 * Diwali Festival Theme — Premium Immersive Edition.
 *
 * Visual Direction:
 * Based on the supplied reference image:
 *   - Deep mahogany-burgundy background (#1a0800 family)
 *   - Amber / molten-gold radial glow at centre
 *   - Hanging diya lamps with live flame highlights
 *   - Intricate gold mandala rangoli in corners
 *   - Soft bokeh light particles (amber / ochre)
 *
 * The full-bleed reference photo is applied as the primary background layer.
 * A translucent scrim preserves UI legibility while keeping the artwork visible.
 *
 * Color tokens are derived directly from the image palette so that surfaces,
 * cards, and interactive states all harmonise with the photographic background.
 */
export const DIWALI_THEME: CustomerTheme = {
  key: 'diwali',
  name: 'Diwali',
  description:
    'Immersive Diwali festival atmosphere — glowing diyas, gold mandala rangoli, and warm amber bokeh set against a deep mahogany backdrop.',
  tokens: {
    surfaces: {
      // Deep mahogany drawn directly from the image shadow regions
      background: '#1a0800',
      backgroundElevated: '#260d02',
      // Semi-transparent so the photo bleeds through slightly
      surface: 'rgba(30, 12, 3, 0.82)',
      surfaceSolid: '#2a0e04',
      surfaceElevated: 'rgba(42, 18, 5, 0.88)',
      surfaceInteractive: '#381508',
    },
    accents: {
      // Molten gold / amber — the lamp flame and glow colour
      primary: '#f5a623',
      primaryHover: '#e09210',
      primaryForeground: '#1a0500',
      primaryGlow: 'rgba(245, 166, 35, 0.30)',
      // Dine-In: deep burnt orange / diya-flame colour — distinct from amber gold
      accentDineIn: '#c2410c',
      accentDineInGlow: 'rgba(194, 65, 12, 0.25)',
      // Takeaway: deep amber gold (mandala highlight)
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.28)',
    },
    text: {
      // Warm ivory — readable on dark mahogany surfaces
      text: '#fff8ee',
      textSecondary: '#f3d5a3',
      textMuted: '#c49a60',
    },
    borders: {
      border: 'rgba(245, 166, 35, 0.22)',
      borderSubtle: 'rgba(245, 166, 35, 0.09)',
      borderHover: 'rgba(245, 166, 35, 0.40)',
      borderActive: 'rgba(245, 166, 35, 0.60)',
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
      shadowSm: '0 2px 8px rgba(0, 0, 0, 0.50)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.60)',
      shadowLg: '0 16px 48px rgba(0, 0, 0, 0.70)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['diwali', 'festival', 'diya', 'gold', 'rangoli', 'mandala', 'amber', 'mahogany'],
    previewAccentColor: '#f5a623',
    previewSurfaceColor: '#2a0e04',
  },
  artwork: {
    motif: 'diwali-rangoli',
    // The SVG motif is kept at very low opacity — the photo is the visual hero
    opacity: 0.07,
    placement: 'top-split',
    // Full-bleed background image: served from Next.js /public static directory
    backgroundImage: '/themes/diwali-bg.png',
  },
};

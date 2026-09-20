import type { CustomerTheme } from '../types';

/**
 * Durga Puja Festival Theme — Luxury Bengali Heritage Edition.
 *
 * Visual Direction:
 * Based on the approved Durga Puja background asset and Bengali festive heritage:
 *   - Deep oxblood, maroon, and dark wine foundations (#160406 / #24090d)
 *   - Translucent dark burgundy/wine glass surfaces (rgba(38, 10, 14, 0.82))
 *   - Rich vermilion & festive crimson Dine-In highlights (#dc2626)
 *   - Radiant antique saffron gold CTA & Takeaway highlights (#d97706 / #f59e0b)
 *   - Subtle antique gold & warm cream borders (rgba(245, 158, 11, 0.18))
 *   - Warm ivory/cream typography (#fffbf2) with strict WCAG AA contrast (>= 7:1)
 *   - High-resolution local background asset (/themes/durga-puja-bg.jpg)
 *   - Custom warm burgundy scrim preserving edge brass diyas, dhak, and floral frame
 */
export const DURGA_PUJA_THEME: CustomerTheme = {
  key: 'durga-puja',
  name: 'Durga Puja',
  description:
    'Majestic Durga Puja festival atmosphere — glowing brass diyas, festive red florals, and dhak artistry with rich burgundy glass surfaces and antique gold accents.',
  tokens: {
    surfaces: {
      background: '#160406',
      backgroundElevated: '#22080c',
      surface: 'rgba(28, 6, 10, 0.52)',
      surfaceSolid: '#24090d',
      surfaceElevated: 'rgba(42, 10, 15, 0.58)',
      surfaceInteractive: 'rgba(56, 14, 20, 0.65)',
    },
    accents: {
      primary: '#b91c1c',
      primaryHover: '#991b1b',
      primaryForeground: '#fffbf2',
      primaryGlow: 'rgba(185, 28, 28, 0.35)',
      accentDineIn: '#dc2626',
      accentDineInGlow: 'rgba(220, 38, 38, 0.22)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.22)',
    },
    text: {
      text: '#fffbf2',
      textSecondary: '#e8d7c5',
      textMuted: '#b8a18d',
    },
    borders: {
      border: 'rgba(245, 158, 11, 0.18)',
      borderSubtle: 'rgba(245, 158, 11, 0.08)',
      borderHover: 'rgba(245, 158, 11, 0.36)',
      borderActive: 'rgba(217, 119, 6, 0.55)',
    },
    status: {
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#dc2626',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(22, 4, 6, 0.45)',
      shadowMd: '0 8px 24px rgba(22, 4, 6, 0.55)',
      shadowLg: '0 16px 48px rgba(22, 4, 6, 0.65)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['durga-puja', 'festival', 'bengali', 'oxblood', 'gold', 'vermilion', 'autumn', 'heritage'],
    previewAccentColor: '#dc2626',
    previewSurfaceColor: '#24090d',
  },
  artwork: {
    motif: 'alpana',
    opacity: 0.08,
    placement: 'top-right',
    backgroundImage: '/themes/durga-puja-bg.jpg',
    scrim:
      'linear-gradient(to bottom, rgba(22, 4, 6, 0.65) 0%, rgba(22, 4, 6, 0.20) 22%, rgba(22, 4, 6, 0.12) 50%, rgba(22, 4, 6, 0.35) 80%, rgba(18, 3, 5, 0.82) 100%)',
  },
};

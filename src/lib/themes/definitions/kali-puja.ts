import type { CustomerTheme } from '../types';

/**
 * Kali Puja Festival Theme — Luxury Midnight Atmosphere Edition.
 *
 * Visual Direction:
 * Based on the approved Kali Puja reference asset:
 *   - Deep midnight navy, indigo, and near-black blue (#070b14 / #0d1322)
 *   - Dark violet & muted purple secondary tones (#1e1b4b / #2e1065)
 *   - Luminous electric violet/indigo CTA accents (#7c3aed / #6366f1)
 *   - Warm amber/gold glowing lamps & diya flame highlights (#f59e0b)
 *   - Deep red hibiscus (joba phul) notes
 *   - Sacred midnight lotus & subtle Bengali ornamental linework
 *   - Controlled midnight scrim preserving moonlit background & glowing diyas
 *   - Strict WCAG AA contrast (warm ivory text #fff9f0 on dark indigo glass)
 */
export const KALI_PUJA_THEME: CustomerTheme = {
  key: 'kali-puja',
  name: 'Kali Puja',
  description:
    'Enchanting Kali Puja midnight festival atmosphere — moonlit indigo skies, glowing brass diyas, and crimson hibiscus with refined violet-indigo glass surfaces.',
  tokens: {
    surfaces: {
      background: '#070b14',
      backgroundElevated: '#0d1322',
      surface: 'rgba(13, 20, 36, 0.82)',
      surfaceSolid: '#0d1424',
      surfaceElevated: 'rgba(18, 28, 50, 0.90)',
      surfaceInteractive: '#1b2848',
    },
    accents: {
      primary: '#7c3aed',
      primaryHover: '#6d28d9',
      primaryForeground: '#ffffff',
      primaryGlow: 'rgba(124, 58, 237, 0.28)',
      accentDineIn: '#6366f1',
      accentDineInGlow: 'rgba(99, 102, 241, 0.22)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.22)',
    },
    text: {
      text: '#fff9f0',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
    },
    borders: {
      border: 'rgba(129, 140, 248, 0.20)',
      borderSubtle: 'rgba(129, 140, 248, 0.08)',
      borderHover: 'rgba(168, 85, 247, 0.38)',
      borderActive: 'rgba(124, 58, 237, 0.55)',
    },
    status: {
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#f43f5e',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(3, 7, 18, 0.45)',
      shadowMd: '0 8px 24px rgba(3, 7, 18, 0.55)',
      shadowLg: '0 16px 48px rgba(3, 7, 18, 0.65)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['kali-puja', 'festival', 'midnight', 'indigo', 'violet', 'diya', 'hibiscus', 'bengali'],
    previewAccentColor: '#7c3aed',
    previewSurfaceColor: '#0d1424',
  },
  artwork: {
    motif: 'midnight-lotus',
    opacity: 0.06,
    placement: 'top-right',
    backgroundImage: '/themes/kali-puja-bg.jpg',
    scrim:
      'linear-gradient(to bottom, rgba(7, 11, 20, 0.65) 0%, rgba(7, 11, 20, 0.20) 22%, rgba(7, 11, 20, 0.12) 50%, rgba(7, 11, 20, 0.35) 80%, rgba(5, 8, 16, 0.82) 100%)',
  },
};

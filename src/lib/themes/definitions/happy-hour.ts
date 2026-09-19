import type { CustomerTheme } from '../types';

/**
 * Happy Hour Occasion Theme.
 *
 * Visual Direction:
 * Warm restaurant evening dining and social celebration.
 * - Background: Deep charred charcoal with warm evening undertone
 * - Surfaces: Warm dark brown and espresso
 * - Primary: Burnt orange and warm copper
 * - Dine-In: Deep copper / orange
 * - Takeaway: Warm amber / gold
 * - Glow: Subtle warm amber and copper (zero nightclub neon)
 * - Text: Warm cream and soft peach
 * - Borders: Muted copper and amber
 *
 * Mood: Evening dining, social, relaxed, warm, energetic but premium hospitality.
 */
export const HAPPY_HOUR_THEME: CustomerTheme = {
  key: 'happy-hour',
  name: 'Happy Hour',
  description: 'Warm evening dining theme with charred charcoal surfaces, burnt orange copper accents, and gentle amber glow.',
  tokens: {
    surfaces: {
      background: '#120e0b',
      backgroundElevated: '#1a1410',
      surface: 'rgba(34, 25, 19, 0.92)',
      surfaceSolid: '#221913',
      surfaceElevated: 'rgba(48, 35, 27, 0.95)',
      surfaceInteractive: '#3a2c22',
    },
    accents: {
      primary: '#ea580c',
      primaryHover: '#c2410c',
      primaryForeground: '#180b08',
      primaryGlow: 'rgba(234, 88, 12, 0.20)',
      accentDineIn: '#c2410c',
      accentDineInGlow: 'rgba(194, 65, 12, 0.20)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.20)',
    },
    text: {
      text: '#fffbeb',
      textSecondary: '#fed7aa',
      textMuted: '#c4956d',
    },
    borders: {
      border: 'rgba(234, 88, 12, 0.20)',
      borderSubtle: 'rgba(234, 88, 12, 0.08)',
      borderHover: 'rgba(245, 158, 11, 0.35)',
      borderActive: 'rgba(245, 158, 11, 0.50)',
    },
    status: {
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#ef4444',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(18, 14, 11, 0.35)',
      shadowMd: '0 8px 24px rgba(18, 14, 11, 0.45)',
      shadowLg: '0 16px 40px rgba(18, 14, 11, 0.55)',
    },
  },
  metadata: {
    category: 'modern',
    tags: ['evening-dining', 'social', 'warm-copper', 'burnt-orange', 'amber', 'happy-hour'],
    previewAccentColor: '#ea580c',
    previewSurfaceColor: '#221913',
  },
  artwork: {
    motif: 'cocktail-lounge',
    opacity: 0.12,
    placement: 'top-right',
  },
};

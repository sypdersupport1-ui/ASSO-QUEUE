import type { CustomerTheme } from '../types';

/**
 * Happy Hour Occasion Theme.
 *
 * Visual Direction:
 * Evening dining and social celebration. Deep charred copper foundation, sunset
 * burnt orange primary, warm copper gold, and honey amber accents.
 * Energetic, warm, social, and premium dining atmosphere.
 */
export const HAPPY_HOUR_THEME: CustomerTheme = {
  key: 'happy-hour',
  name: 'Happy Hour',
  description: 'Warm evening occasion theme with charred copper surfaces, sunset burnt orange accents, and glowing amber tones.',
  tokens: {
    surfaces: {
      background: '#100b08',
      backgroundElevated: '#18110c',
      surface: 'rgba(32, 22, 16, 0.90)',
      surfaceSolid: '#221711',
      surfaceElevated: 'rgba(44, 30, 22, 0.94)',
      surfaceInteractive: '#34241b',
    },
    accents: {
      primary: '#ea580c',
      primaryHover: '#c2410c',
      primaryForeground: '#180b08',
      primaryGlow: 'rgba(234, 88, 12, 0.25)',
      accentDineIn: '#c2410c',
      accentDineInGlow: 'rgba(194, 65, 12, 0.24)',
      accentTakeaway: '#eab308',
      accentTakeawayGlow: 'rgba(234, 179, 8, 0.24)',
    },
    text: {
      text: '#fffbeb',
      textSecondary: '#fed7aa',
      textMuted: '#c4956d',
    },
    borders: {
      border: 'rgba(234, 88, 12, 0.20)',
      borderSubtle: 'rgba(234, 88, 12, 0.08)',
      borderHover: 'rgba(234, 88, 12, 0.38)',
      borderActive: 'rgba(245, 158, 11, 0.52)',
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
      shadowSm: '0 2px 8px rgba(22, 12, 8, 0.35)',
      shadowMd: '0 8px 24px rgba(22, 12, 8, 0.45)',
      shadowLg: '0 16px 40px rgba(22, 12, 8, 0.55)',
    },
  },
  metadata: {
    category: 'modern',
    tags: ['evening', 'social', 'amber', 'copper', 'happy-hour', 'after-work'],
    previewAccentColor: '#ea580c',
    previewSurfaceColor: '#221711',
  },
};

import type { CustomerTheme } from '../types';

/**
 * Durga Puja Festival Theme.
 *
 * Visual Direction:
 * Rich Bengali festive hospitality. Warm royal vermilion, radiant festive gold,
 * and ivory cream on a deep crimson-slate foundation.
 * Restrained traditional warmth without literal religious posters or theatrical deity art.
 */
export const DURGA_PUJA_THEME: CustomerTheme = {
  key: 'durga-puja',
  name: 'Durga Puja',
  description: 'Rich Bengali festive hospitality with deep vermilion foundations, radiant warm gold, and refined ivory accents.',
  tokens: {
    surfaces: {
      background: '#1a0709',
      backgroundElevated: '#240d10',
      surface: 'rgba(42, 14, 18, 0.88)',
      surfaceSolid: '#2a0f13',
      surfaceElevated: 'rgba(58, 20, 25, 0.94)',
      surfaceInteractive: '#38141a',
    },
    accents: {
      primary: '#d97706',
      primaryHover: '#b45309',
      primaryForeground: '#1a0709',
      primaryGlow: 'rgba(217, 119, 6, 0.22)',
      accentDineIn: '#dc2626',
      accentDineInGlow: 'rgba(220, 38, 38, 0.22)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.22)',
    },
    text: {
      text: '#fffbf5',
      textSecondary: '#e8d5c4',
      textMuted: '#b39a82',
    },
    borders: {
      border: 'rgba(234, 179, 8, 0.18)',
      borderSubtle: 'rgba(234, 179, 8, 0.08)',
      borderHover: 'rgba(234, 179, 8, 0.32)',
      borderActive: 'rgba(234, 179, 8, 0.50)',
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
      shadowSm: '0 2px 8px rgba(35, 6, 9, 0.35)',
      shadowMd: '0 8px 24px rgba(35, 6, 9, 0.45)',
      shadowLg: '0 16px 40px rgba(35, 6, 9, 0.55)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['festive', 'bengali', 'durga-puja', 'gold', 'vermilion', 'autumn'],
    previewAccentColor: '#dc2626',
    previewSurfaceColor: '#2a0f13',
  },
};

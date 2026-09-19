import type { CustomerTheme } from '../types';

/**
 * Diwali Festival Theme.
 *
 * Visual Direction:
 * Luminous celebration. Deep charcoal obsidian foundation, radiant celebratory gold,
 * saffron, and warm amber glows suggesting lamps and prosperity without excessive neon.
 */
export const DIWALI_THEME: CustomerTheme = {
  key: 'diwali',
  name: 'Diwali',
  description: 'Luminous festive celebration with deep obsidian surfaces, radiant celebratory gold, and warm amber glows.',
  tokens: {
    surfaces: {
      background: '#0c0d12',
      backgroundElevated: '#141722',
      surface: 'rgba(26, 28, 38, 0.90)',
      surfaceSolid: '#181b24',
      surfaceElevated: 'rgba(38, 42, 58, 0.94)',
      surfaceInteractive: '#242838',
    },
    accents: {
      primary: '#f59e0b',
      primaryHover: '#d97706',
      primaryForeground: '#181102',
      primaryGlow: 'rgba(245, 158, 11, 0.25)',
      accentDineIn: '#ea580c',
      accentDineInGlow: 'rgba(234, 88, 12, 0.22)',
      accentTakeaway: '#eab308',
      accentTakeawayGlow: 'rgba(234, 179, 8, 0.25)',
    },
    text: {
      text: '#fefce8',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
    },
    borders: {
      border: 'rgba(245, 158, 11, 0.20)',
      borderSubtle: 'rgba(245, 158, 11, 0.08)',
      borderHover: 'rgba(245, 158, 11, 0.35)',
      borderActive: 'rgba(245, 158, 11, 0.55)',
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
      shadowSm: '0 2px 8px rgba(10, 10, 15, 0.35)',
      shadowMd: '0 8px 24px rgba(10, 10, 15, 0.45)',
      shadowLg: '0 16px 40px rgba(10, 10, 15, 0.55)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['luminous', 'gold', 'saffron', 'diwali', 'celebration', 'lamps'],
    previewAccentColor: '#f59e0b',
    previewSurfaceColor: '#181b24',
  },
};

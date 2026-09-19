import type { CustomerTheme } from '../types';

/**
 * Happy New Year Theme.
 *
 * Visual Direction:
 * Modern celebration. Deep celestial midnight navy foundation, sparkling champagne
 * gold primary, sapphire blue Dine-In, and effervescent amber Takeaway accents.
 * Sophisticated, optimistic, and celebratory.
 */
export const HAPPY_NEW_YEAR_THEME: CustomerTheme = {
  key: 'happy-new-year',
  name: 'Happy New Year',
  description: 'Sophisticated modern celebration with deep celestial navy surfaces, sparkling champagne gold, and vibrant sapphire accents.',
  tokens: {
    surfaces: {
      background: '#080c18',
      backgroundElevated: '#0f162a',
      surface: 'rgba(18, 26, 48, 0.90)',
      surfaceSolid: '#141d36',
      surfaceElevated: 'rgba(26, 38, 70, 0.94)',
      surfaceInteractive: '#202f54',
    },
    accents: {
      primary: '#eab308',
      primaryHover: '#ca8a04',
      primaryForeground: '#090d1a',
      primaryGlow: 'rgba(234, 179, 8, 0.26)',
      accentDineIn: '#3b82f6',
      accentDineInGlow: 'rgba(59, 130, 246, 0.24)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.24)',
    },
    text: {
      text: '#f8fafc',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
    },
    borders: {
      border: 'rgba(234, 179, 8, 0.20)',
      borderSubtle: 'rgba(255, 255, 255, 0.08)',
      borderHover: 'rgba(234, 179, 8, 0.38)',
      borderActive: 'rgba(234, 179, 8, 0.55)',
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
      shadowSm: '0 2px 8px rgba(6, 10, 22, 0.35)',
      shadowMd: '0 8px 24px rgba(6, 10, 22, 0.45)',
      shadowLg: '0 16px 40px rgba(6, 10, 22, 0.55)',
    },
  },
  metadata: {
    category: 'modern',
    season: 'Year End / January',
    tags: ['navy', 'champagne', 'gold', 'celebration', 'new-year', 'optimistic'],
    previewAccentColor: '#eab308',
    previewSurfaceColor: '#141d36',
  },
};

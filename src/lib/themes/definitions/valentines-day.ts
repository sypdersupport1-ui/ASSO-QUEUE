import type { CustomerTheme } from '../types';

/**
 * Valentine's Day Theme.
 *
 * Visual Direction:
 * Refined romantic dining. Deep vintage burgundy wine foundation, velvety satin
 * ruby primary, intimate rose accents, and warm champagne blush highlights.
 * Elegant, intimate, and sophisticated for candlelit hospitality.
 */
export const VALENTINES_DAY_THEME: CustomerTheme = {
  key: 'valentines-day',
  name: "Valentine's Day",
  description: 'Refined romantic dining with deep burgundy wine surfaces, satin ruby accents, and warm champagne blush highlights.',
  tokens: {
    surfaces: {
      background: '#16080e',
      backgroundElevated: '#220d16',
      surface: 'rgba(38, 16, 26, 0.88)',
      surfaceSolid: '#28111c',
      surfaceElevated: 'rgba(52, 22, 36, 0.94)',
      surfaceInteractive: '#3c192a',
    },
    accents: {
      primary: '#e11d48',
      primaryHover: '#be123c',
      primaryForeground: '#ffffff',
      primaryGlow: 'rgba(225, 29, 72, 0.24)',
      accentDineIn: '#f43f5e',
      accentDineInGlow: 'rgba(244, 63, 94, 0.22)',
      accentTakeaway: '#fb7185',
      accentTakeawayGlow: 'rgba(251, 113, 133, 0.22)',
    },
    text: {
      text: '#fff1f2',
      textSecondary: '#fbcfe8',
      textMuted: '#fda4af',
    },
    borders: {
      border: 'rgba(244, 63, 94, 0.18)',
      borderSubtle: 'rgba(244, 63, 94, 0.08)',
      borderHover: 'rgba(244, 63, 94, 0.35)',
      borderActive: 'rgba(225, 29, 72, 0.50)',
    },
    status: {
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#e11d48',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(26, 8, 16, 0.35)',
      shadowMd: '0 8px 24px rgba(26, 8, 16, 0.45)',
      shadowLg: '0 16px 40px rgba(26, 8, 16, 0.55)',
    },
  },
  metadata: {
    category: 'seasonal',
    season: 'February',
    tags: ['romantic', 'wine', 'rose', 'valentines', 'intimate', 'dining'],
    previewAccentColor: '#e11d48',
    previewSurfaceColor: '#28111c',
  },
};

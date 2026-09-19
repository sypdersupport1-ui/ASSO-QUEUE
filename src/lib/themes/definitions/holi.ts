import type { CustomerTheme } from '../types';

/**
 * Holi Festival Theme.
 *
 * Visual Direction:
 * Energetic, joyful, color-forward. Twilight violet foundation with vivid
 * gulal fuchsia, rose red, and turquoise cyan accents.
 * Vibrant and festive while maintaining a coherent hospitality hierarchy.
 */
export const HOLI_THEME: CustomerTheme = {
  key: 'holi',
  name: 'Holi',
  description: 'Vibrant, joyful celebration with twilight violet surfaces, vivid gulal fuchsia primary, and energetic turquoise accents.',
  tokens: {
    surfaces: {
      background: '#100a1c',
      backgroundElevated: '#19112a',
      surface: 'rgba(32, 22, 54, 0.88)',
      surfaceSolid: '#22173a',
      surfaceElevated: 'rgba(45, 30, 75, 0.94)',
      surfaceInteractive: '#342255',
    },
    accents: {
      primary: '#db2777',
      primaryHover: '#be185d',
      primaryForeground: '#ffffff',
      primaryGlow: 'rgba(219, 39, 119, 0.28)',
      accentDineIn: '#f43f5e',
      accentDineInGlow: 'rgba(244, 63, 94, 0.25)',
      accentTakeaway: '#06b6d4',
      accentTakeawayGlow: 'rgba(6, 182, 212, 0.25)',
    },
    text: {
      text: '#fdf2f8',
      textSecondary: '#e2e8f0',
      textMuted: '#c084fc',
    },
    borders: {
      border: 'rgba(236, 72, 153, 0.20)',
      borderSubtle: 'rgba(168, 85, 247, 0.10)',
      borderHover: 'rgba(236, 72, 153, 0.38)',
      borderActive: 'rgba(6, 182, 212, 0.50)',
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
      shadowSm: '0 2px 8px rgba(16, 10, 28, 0.35)',
      shadowMd: '0 8px 24px rgba(16, 10, 28, 0.45)',
      shadowLg: '0 16px 40px rgba(16, 10, 28, 0.55)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Spring',
    tags: ['vibrant', 'playful', 'pink', 'cyan', 'holi', 'spring', 'colors'],
    previewAccentColor: '#ec4899',
    previewSurfaceColor: '#22173a',
  },
};

import type { CustomerTheme } from '../types';

/**
 * Christmas Theme.
 *
 * Visual Direction:
 * Warm seasonal hospitality. Deep evergreen fir foundation, velvet crimson primary,
 * holiday pine accents, and muted gold highlights.
 * Welcoming, cozy, and sophisticated without childish cartoon cliches.
 */
export const CHRISTMAS_THEME: CustomerTheme = {
  key: 'christmas',
  name: 'Christmas',
  description: 'Warm seasonal hospitality with deep evergreen surfaces, rich velvet crimson primary, and subtle festive gold accents.',
  tokens: {
    surfaces: {
      background: '#08140e',
      backgroundElevated: '#0e2017',
      surface: 'rgba(18, 38, 28, 0.90)',
      surfaceSolid: '#142d21',
      surfaceElevated: 'rgba(26, 52, 38, 0.94)',
      surfaceInteractive: '#1d4130',
    },
    accents: {
      primary: '#dc2626',
      primaryHover: '#b91c1c',
      primaryForeground: '#ffffff',
      primaryGlow: 'rgba(220, 38, 38, 0.24)',
      accentDineIn: '#ef4444',
      accentDineInGlow: 'rgba(239, 68, 68, 0.22)',
      accentTakeaway: '#10b981',
      accentTakeawayGlow: 'rgba(16, 185, 129, 0.22)',
    },
    text: {
      text: '#fefce8',
      textSecondary: '#dcfce7',
      textMuted: '#86efac',
    },
    borders: {
      border: 'rgba(234, 179, 8, 0.18)',
      borderSubtle: 'rgba(16, 185, 129, 0.10)',
      borderHover: 'rgba(234, 179, 8, 0.35)',
      borderActive: 'rgba(220, 38, 38, 0.50)',
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
      shadowSm: '0 2px 8px rgba(6, 16, 11, 0.35)',
      shadowMd: '0 8px 24px rgba(6, 16, 11, 0.45)',
      shadowLg: '0 16px 40px rgba(6, 16, 11, 0.55)',
    },
  },
  metadata: {
    category: 'seasonal',
    season: 'Winter',
    tags: ['evergreen', 'crimson', 'cozy', 'christmas', 'winter', 'hospitality'],
    previewAccentColor: '#dc2626',
    previewSurfaceColor: '#142d21',
  },
  artwork: {
    motif: 'evergreen-festive',
    opacity: 0.11,
    placement: 'top-right',
  },
};

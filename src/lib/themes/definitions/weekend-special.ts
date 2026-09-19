import type { CustomerTheme } from '../types';

/**
 * Weekend Special Occasion Theme.
 *
 * Visual Direction:
 * Relaxed weekend hospitality. Deep botanical olive charcoal surfaces, warm toasted
 * mustard gold primary, sage green Dine-In, and golden mustard Takeaway accents.
 * Welcoming, friendly, and premium casual for family and social weekend dining.
 */
export const WEEKEND_SPECIAL_THEME: CustomerTheme = {
  key: 'weekend-special',
  name: 'Weekend Special',
  description: 'Relaxed weekend dining with botanical olive surfaces, toasted mustard gold accents, and fresh sage highlights.',
  tokens: {
    surfaces: {
      background: '#0c120e',
      backgroundElevated: '#121a15',
      surface: 'rgba(22, 34, 26, 0.90)',
      surfaceSolid: '#18241c',
      surfaceElevated: 'rgba(32, 48, 38, 0.94)',
      surfaceInteractive: '#24372a',
    },
    accents: {
      primary: '#d97706',
      primaryHover: '#b45309',
      primaryForeground: '#181102',
      primaryGlow: 'rgba(217, 119, 6, 0.22)',
      accentDineIn: '#10b981',
      accentDineInGlow: 'rgba(16, 185, 129, 0.22)',
      accentTakeaway: '#eab308',
      accentTakeawayGlow: 'rgba(234, 179, 8, 0.22)',
    },
    text: {
      text: '#f8fafc',
      textSecondary: '#cbd5e1',
      textMuted: '#86efac',
    },
    borders: {
      border: 'rgba(16, 185, 129, 0.18)',
      borderSubtle: 'rgba(16, 185, 129, 0.08)',
      borderHover: 'rgba(217, 119, 6, 0.32)',
      borderActive: 'rgba(217, 119, 6, 0.50)',
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
      shadowSm: '0 2px 8px rgba(8, 16, 10, 0.35)',
      shadowMd: '0 8px 24px rgba(8, 16, 10, 0.45)',
      shadowLg: '0 16px 40px rgba(8, 16, 10, 0.55)',
    },
  },
  metadata: {
    category: 'modern',
    tags: ['casual', 'botanical', 'weekend', 'gold', 'mustard', 'hospitality'],
    previewAccentColor: '#d97706',
    previewSurfaceColor: '#18241c',
  },
  artwork: {
    motif: 'botanical-brunch',
    opacity: 0.11,
    placement: 'top-right',
  },
};

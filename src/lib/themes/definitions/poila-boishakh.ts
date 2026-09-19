import type { CustomerTheme } from '../types';

/**
 * Poila Boishakh (Bengali New Year) Theme.
 *
 * Visual Direction:
 * Bengali New Year hospitality. Rich earthen terracotta foundation, shubh sindoor
 * crimson primary, fresh harvest green accents, and traditional alpona ivory highlights.
 * Authentic, culturally rooted, and fresh.
 */
export const POILA_BOISHAKH_THEME: CustomerTheme = {
  key: 'poila-boishakh',
  name: 'Poila Boishakh',
  description: 'Bengali New Year celebration with earthy terracotta surfaces, shubh sindoor crimson, and fresh harvest green accents.',
  tokens: {
    surfaces: {
      background: '#160e0a',
      backgroundElevated: '#221610',
      surface: 'rgba(40, 25, 18, 0.90)',
      surfaceSolid: '#2a1b14',
      surfaceElevated: 'rgba(54, 34, 24, 0.94)',
      surfaceInteractive: '#3c261b',
    },
    accents: {
      primary: '#dc2626',
      primaryHover: '#b91c1c',
      primaryForeground: '#ffffff',
      primaryGlow: 'rgba(220, 38, 38, 0.24)',
      accentDineIn: '#ea580c',
      accentDineInGlow: 'rgba(234, 88, 12, 0.22)',
      accentTakeaway: '#16a34a',
      accentTakeawayGlow: 'rgba(22, 163, 74, 0.22)',
    },
    text: {
      text: '#fffbeb',
      textSecondary: '#fed7aa',
      textMuted: '#c4a482',
    },
    borders: {
      border: 'rgba(234, 179, 8, 0.20)',
      borderSubtle: 'rgba(234, 179, 8, 0.08)',
      borderHover: 'rgba(234, 179, 8, 0.38)',
      borderActive: 'rgba(220, 38, 38, 0.50)',
    },
    status: {
      success: '#16a34a',
      warning: '#ea580c',
      danger: '#dc2626',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(24, 14, 10, 0.35)',
      shadowMd: '0 8px 24px rgba(24, 14, 10, 0.45)',
      shadowLg: '0 16px 40px rgba(24, 14, 10, 0.55)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Spring / Baishakh',
    tags: ['bengali', 'new-year', 'poila-boishakh', 'crimson', 'terracotta', 'harvest'],
    previewAccentColor: '#dc2626',
    previewSurfaceColor: '#2a1b14',
  },
  artwork: {
    motif: 'boishakh-heritage',
    opacity: 0.12,
    placement: 'corner-ornaments',
  },
};

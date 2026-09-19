import type { CustomerTheme } from '../types';

/**
 * Kali Puja Festival Theme.
 *
 * Visual Direction:
 * Darker, dramatic Bengali festive variant. Deep midnight indigo, charcoal,
 * electric hibiscus crimson, and controlled saffron highlights.
 * Mysterious, elegant, dramatic evening atmosphere with strict WCAG AA contrast.
 */
export const KALI_PUJA_THEME: CustomerTheme = {
  key: 'kali-puja',
  name: 'Kali Puja',
  description: 'Dramatic Bengali festive evening theme with deep midnight indigo surfaces, hibiscus crimson accents, and radiant saffron warmth.',
  tokens: {
    surfaces: {
      background: '#090a14',
      backgroundElevated: '#101222',
      surface: 'rgba(20, 22, 42, 0.90)',
      surfaceSolid: '#14162a',
      surfaceElevated: 'rgba(28, 32, 60, 0.94)',
      surfaceInteractive: '#222648',
    },
    accents: {
      primary: '#e11d48',
      primaryHover: '#be123c',
      primaryForeground: '#ffffff',
      primaryGlow: 'rgba(225, 29, 72, 0.25)',
      accentDineIn: '#dc2626',
      accentDineInGlow: 'rgba(220, 38, 38, 0.22)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.22)',
    },
    text: {
      text: '#f8faff',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
    },
    borders: {
      border: 'rgba(129, 140, 248, 0.16)',
      borderSubtle: 'rgba(129, 140, 248, 0.08)',
      borderHover: 'rgba(168, 85, 247, 0.28)',
      borderActive: 'rgba(225, 29, 72, 0.45)',
    },
    status: {
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#f43f5e',
    },
    geometry: {
      radiusSm: '0.5rem',
      radiusMd: '0.875rem',
      radiusLg: '1.25rem',
      radiusXl: '1.5rem',
      shadowSm: '0 2px 8px rgba(5, 6, 14, 0.40)',
      shadowMd: '0 8px 24px rgba(5, 6, 14, 0.50)',
      shadowLg: '0 16px 40px rgba(5, 6, 14, 0.60)',
    },
  },
  metadata: {
    category: 'cultural',
    season: 'Autumn',
    tags: ['dramatic', 'indigo', 'crimson', 'kali-puja', 'evening', 'bengali'],
    previewAccentColor: '#e11d48',
    previewSurfaceColor: '#14162a',
  },
};

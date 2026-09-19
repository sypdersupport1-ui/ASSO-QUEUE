import type { CustomerTheme } from './types';

/**
 * Canonical Phase 1 Default Customer Theme: QueueFlow Premium.
 *
 * Guaranteed exact match with Phase 1 visual tokens:
 * - Refined dark slate hospitality foundation
 * - Vivid emerald primary CTA (#10b981)
 * - Slate blue Dine-In channel accent (#3b82f6)
 * - Warm amber Takeaway channel accent (#f59e0b)
 * - Subtle borders (rgba(255, 255, 255, 0.08)) and restrained elevation
 */
export const DEFAULT_CUSTOMER_THEME: CustomerTheme = {
  key: 'default',
  name: 'QueueFlow Premium',
  description: 'Tactile, sophisticated hospitality design system with refined dark slate foundation and high-contrast channel accents.',
  tokens: {
    surfaces: {
      background: '#0c1017',
      backgroundElevated: '#111722',
      surface: 'rgba(18, 24, 38, 0.88)',
      surfaceSolid: '#121826',
      surfaceElevated: 'rgba(25, 34, 52, 0.94)',
      surfaceInteractive: '#1a2336',
    },
    accents: {
      primary: '#10b981',
      primaryHover: '#059669',
      primaryForeground: '#022c22',
      primaryGlow: 'rgba(16, 185, 129, 0.18)',
      accentDineIn: '#3b82f6',
      accentDineInGlow: 'rgba(59, 130, 246, 0.18)',
      accentTakeaway: '#f59e0b',
      accentTakeawayGlow: 'rgba(245, 158, 11, 0.18)',
    },
    text: {
      text: '#f8fafc',
      textSecondary: '#94a3b8',
      textMuted: '#64748b',
    },
    borders: {
      border: 'rgba(255, 255, 255, 0.08)',
      borderSubtle: 'rgba(255, 255, 255, 0.04)',
      borderHover: 'rgba(255, 255, 255, 0.14)',
      borderActive: 'rgba(255, 255, 255, 0.24)',
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
      shadowSm: '0 2px 8px rgba(0, 0, 0, 0.25)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.35)',
      shadowLg: '0 16px 40px rgba(0, 0, 0, 0.45)',
    },
  },
  metadata: {
    category: 'core',
    tags: ['hospitality', 'dark', 'premium', 'default'],
    previewAccentColor: '#10b981',
    previewSurfaceColor: '#121826',
  },
};

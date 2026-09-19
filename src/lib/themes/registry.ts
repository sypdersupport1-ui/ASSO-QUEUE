import type { CustomerTheme } from './types';
import { DEFAULT_CUSTOMER_THEME } from './default-theme';

/**
 * Canonical Theme Registry.
 *
 * Single source of truth for all approved customer-facing presentation themes.
 * Phase 2 registers the default theme.
 * Phase 3 will plug in approved festival theme packs (Durga Puja, Diwali, Christmas, etc.)
 * directly into this registry without touching business logic or customer UI components.
 */
export const THEME_REGISTRY: Record<string, CustomerTheme> = {
  [DEFAULT_CUSTOMER_THEME.key]: DEFAULT_CUSTOMER_THEME,
};

/**
 * Returns all registered, approved customer themes for admin curation/selection.
 */
export function getRegisteredThemes(): CustomerTheme[] {
  return Object.values(THEME_REGISTRY);
}

/**
 * Validates whether a theme key corresponds to an approved registered theme.
 */
export function isRegisteredTheme(key: string | null | undefined): boolean {
  if (!key || typeof key !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(THEME_REGISTRY, key.trim().toLowerCase());
}

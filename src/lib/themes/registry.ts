import type { CustomerTheme } from './types';
import { DEFAULT_CUSTOMER_THEME } from './default-theme';
import {
  DURGA_PUJA_THEME,
  KALI_PUJA_THEME,
  DIWALI_THEME,
  HOLI_THEME,
  CHRISTMAS_THEME,
  VALENTINES_DAY_THEME,
  POILA_BOISHAKH_THEME,
  HAPPY_NEW_YEAR_THEME,
  HAPPY_HOUR_THEME,
  WEEKEND_SPECIAL_THEME,
} from './definitions';

/**
 * Canonical Theme Registry.
 *
 * Single source of truth for all 11 approved customer-facing presentation themes.
 * Operates strictly as a presentation-layer registry:
 * - 100% theme-agnostic customer components
 * - Zero mutation to queue, seating, takeaway, order, or payment business logic
 * - Safe fallback to DEFAULT_CUSTOMER_THEME on unknown or empty keys
 */
export const THEME_REGISTRY: Record<string, CustomerTheme> = {
  [DEFAULT_CUSTOMER_THEME.key]: DEFAULT_CUSTOMER_THEME,
  [DURGA_PUJA_THEME.key]: DURGA_PUJA_THEME,
  [KALI_PUJA_THEME.key]: KALI_PUJA_THEME,
  [DIWALI_THEME.key]: DIWALI_THEME,
  [HOLI_THEME.key]: HOLI_THEME,
  [CHRISTMAS_THEME.key]: CHRISTMAS_THEME,
  [VALENTINES_DAY_THEME.key]: VALENTINES_DAY_THEME,
  [POILA_BOISHAKH_THEME.key]: POILA_BOISHAKH_THEME,
  [HAPPY_NEW_YEAR_THEME.key]: HAPPY_NEW_YEAR_THEME,
  [HAPPY_HOUR_THEME.key]: HAPPY_HOUR_THEME,
  [WEEKEND_SPECIAL_THEME.key]: WEEKEND_SPECIAL_THEME,
};

/**
 * Returns all 11 registered, approved customer themes for admin curation/selection.
 */
export function getRegisteredThemes(): CustomerTheme[] {
  return Object.values(THEME_REGISTRY);
}

/**
 * Validates whether a theme key corresponds to an approved registered theme.
 * Case-insensitive and whitespace-trimmed lookup.
 */
export function isRegisteredTheme(key: string | null | undefined): boolean {
  if (!key || typeof key !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(THEME_REGISTRY, key.trim().toLowerCase());
}

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUSTOMER_THEME,
  THEME_REGISTRY,
  getRegisteredThemes,
  isRegisteredTheme,
  resolveCustomerTheme,
  themeToCssVariables,
  type CustomerTheme,
} from '@/lib/themes';
import { updateRestaurantProfileSchema } from '@/lib/services/restaurant-admin-service';
import { updateRestaurantSchema } from '@/lib/services/platform-service';

describe('Phase 2 — Customer Theme Engine Architecture', () => {
  describe('1 & 2. Default & Registered Theme Resolution', () => {
    it('resolves the default theme correctly when key is "default"', () => {
      const theme = resolveCustomerTheme('default');
      expect(theme).toBeDefined();
      expect(theme.key).toBe('default');
      expect(theme.name).toBe('QueueFlow Premium');
      expect(theme).toEqual(DEFAULT_CUSTOMER_THEME);
    });

    it('handles case-insensitivity and whitespace cleanly', () => {
      const theme = resolveCustomerTheme('  DEFAULT  ');
      expect(theme.key).toBe('default');
      expect(theme).toEqual(DEFAULT_CUSTOMER_THEME);
    });
  });

  describe('3 & 4. Safe Fallbacks for Unknown, Null, Empty, and Arbitrary Strings', () => {
    it('falls back to default theme for null, undefined, or empty strings', () => {
      expect(resolveCustomerTheme(null)).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme(undefined)).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('   ')).toEqual(DEFAULT_CUSTOMER_THEME);
    });

    it('falls back to default theme for unknown or future festival keys (no Phase 3 premature leaks)', () => {
      expect(resolveCustomerTheme('durga-puja')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('diwali')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('christmas')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('non_existent_theme_999')).toEqual(DEFAULT_CUSTOMER_THEME);
    });

    it('safely rejects malicious or arbitrary CSS strings without injecting or throwing', () => {
      const arbitraryCss = 'body { background: red; }';
      const theme = resolveCustomerTheme(arbitraryCss);
      expect(theme).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(theme.key).toBe('default');
    });
  });

  describe('5 & 6. Canonical Theme Registry & Semantic Token Vocabulary', () => {
    it('registry contains only valid theme definitions', () => {
      const registered = getRegisteredThemes();
      expect(registered.length).toBeGreaterThanOrEqual(1);

      for (const theme of registered) {
        expect(theme.key).toBeDefined();
        expect(typeof theme.key).toBe('string');
        expect(theme.name).toBeDefined();
        expect(theme.tokens).toBeDefined();
        expect(THEME_REGISTRY[theme.key]).toBe(theme);
        expect(isRegisteredTheme(theme.key)).toBe(true);
      }
    });

    it('isRegisteredTheme accurately validates known and rejects unknown keys', () => {
      expect(isRegisteredTheme('default')).toBe(true);
      expect(isRegisteredTheme('DEFAULT')).toBe(true);
      expect(isRegisteredTheme('unknown-key')).toBe(false);
      expect(isRegisteredTheme(null)).toBe(false);
      expect(isRegisteredTheme(undefined)).toBe(false);
      expect(isRegisteredTheme('')).toBe(false);
    });

    it('contains all required semantic design tokens conforming to Phase 1 foundation', () => {
      const { surfaces, accents, text, borders, status, geometry } = DEFAULT_CUSTOMER_THEME.tokens;

      // Surfaces
      expect(surfaces.background).toBe('#0c1017');
      expect(surfaces.backgroundElevated).toBe('#111722');
      expect(surfaces.surface).toBe('rgba(18, 24, 38, 0.88)');
      expect(surfaces.surfaceSolid).toBe('#121826');
      expect(surfaces.surfaceElevated).toBe('rgba(25, 34, 52, 0.94)');
      expect(surfaces.surfaceInteractive).toBe('#1a2336');

      // Accents (hospitality primary emerald, Dine-In blue, Takeaway amber)
      expect(accents.primary).toBe('#10b981');
      expect(accents.primaryHover).toBe('#059669');
      expect(accents.primaryForeground).toBe('#022c22');
      expect(accents.accentDineIn).toBe('#3b82f6');
      expect(accents.accentTakeaway).toBe('#f59e0b');

      // Text & Borders
      expect(text.text).toBe('#f8fafc');
      expect(text.textSecondary).toBe('#94a3b8');
      expect(text.textMuted).toBe('#64748b');
      expect(borders.border).toBe('rgba(255, 255, 255, 0.08)');
      expect(borders.borderSubtle).toBe('rgba(255, 255, 255, 0.04)');
      expect(borders.borderActive).toBe('rgba(255, 255, 255, 0.24)');

      // Glow Accents
      expect(accents.primaryGlow).toBe('rgba(16, 185, 129, 0.18)');
      expect(accents.accentDineInGlow).toBe('rgba(59, 130, 246, 0.18)');
      expect(accents.accentTakeawayGlow).toBe('rgba(245, 158, 11, 0.18)');

      // Status & Geometry
      expect(status.success).toBe('#10b981');
      expect(status.warning).toBe('#f59e0b');
      expect(status.danger).toBe('#ef4444');
      expect(geometry.radiusSm).toBe('0.5rem');
      expect(geometry.radiusMd).toBe('0.875rem');
      expect(geometry.radiusLg).toBe('1.25rem');
      expect(geometry.radiusXl).toBe('1.5rem');
      expect(geometry.shadowSm).toBe('0 2px 8px rgba(0, 0, 0, 0.25)');
      expect(geometry.shadowMd).toBe('0 8px 24px rgba(0, 0, 0, 0.35)');
      expect(geometry.shadowLg).toBe('0 16px 40px rgba(0, 0, 0, 0.45)');
    });

    it('themeToCssVariables converts token object to full --qf-* custom property map', () => {
      const cssVars = themeToCssVariables(DEFAULT_CUSTOMER_THEME) as Record<string, string>;

      expect(cssVars['--qf-background']).toBe('#0c1017');
      expect(cssVars['--qf-primary']).toBe('#10b981');
      expect(cssVars['--qf-accent-dine-in']).toBe('#3b82f6');
      expect(cssVars['--qf-accent-takeaway']).toBe('#f59e0b');
      expect(cssVars['--qf-text']).toBe('#f8fafc');
      expect(cssVars['--qf-border']).toBe('rgba(255, 255, 255, 0.08)');
      expect(cssVars['--qf-radius-xl']).toBe('1.5rem');
      expect(cssVars['--qf-shadow-md']).toBe('0 8px 24px rgba(0, 0, 0, 0.35)');
    });
  });

  describe('7 & 8. Admin Selection Validation & Tenant Safety', () => {
    it('validates customer_theme_key in updateRestaurantProfileSchema', () => {
      const valid = updateRestaurantProfileSchema.safeParse({
        name: 'Grand Bistro',
        customer_theme_key: 'default',
      });
      expect(valid.success).toBe(true);

      const empty = updateRestaurantProfileSchema.safeParse({
        name: 'Grand Bistro',
      });
      expect(empty.success).toBe(true);

      const invalid = updateRestaurantProfileSchema.safeParse({
        name: 'Grand Bistro',
        customer_theme_key: 'durga-puja-unregistered',
      });
      expect(invalid.success).toBe(false);

      const malicious = updateRestaurantProfileSchema.safeParse({
        name: 'Grand Bistro',
        customer_theme_key: '<style>body{color:red}</style>',
      });
      expect(malicious.success).toBe(false);
    });

    it('validates customer_theme_key in platform-service updateRestaurantSchema', () => {
      const valid = updateRestaurantSchema.safeParse({
        customer_theme_key: 'default',
      });
      expect(valid.success).toBe(true);

      const invalid = updateRestaurantSchema.safeParse({
        customer_theme_key: 'arbitrary-theme-key',
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('9. Server-First Resolution Integrity', () => {
    it('resolves synchronously without external network requests or client state', () => {
      const start = performance.now();
      const theme = resolveCustomerTheme('default');
      const cssVars = themeToCssVariables(theme);
      const duration = performance.now() - start;

      expect(theme.key).toBe('default');
      expect(Object.keys(cssVars).length).toBeGreaterThan(20);
      expect(duration).toBeLessThan(5); // Pure CPU execution under 5ms
    });
  });

  describe('10. Business Invariant Preservation', () => {
    it('theme contract maintains strict separation from restaurant operational configuration', () => {
      const theme: CustomerTheme = DEFAULT_CUSTOMER_THEME;

      // CustomerTheme must only contain visual presentation tokens and metadata
      expect(theme).not.toHaveProperty('queueEnabled');
      expect(theme).not.toHaveProperty('maxCapacity');
      expect(theme).not.toHaveProperty('pricing');
      expect(theme).not.toHaveProperty('currency');
      expect(theme).not.toHaveProperty('seating_mode');
    });
  });
});

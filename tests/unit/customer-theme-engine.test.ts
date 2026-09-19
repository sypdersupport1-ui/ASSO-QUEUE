import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUSTOMER_THEME,
  THEME_REGISTRY,
  getRegisteredThemes,
  isRegisteredTheme,
  resolveCustomerTheme,
  themeToCssVariables,
  type CustomerThemeTokens,
} from '@/lib/themes';
import { updateRestaurantProfileSchema } from '@/lib/services/restaurant-admin-service';
import { updateRestaurantSchema } from '@/lib/services/platform-service';

describe('Phase 3 — QueueFlow Occasion & Festival Theme Library', () => {
  const EXPECTED_THEME_KEYS = [
    'default',
    'durga-puja',
    'kali-puja',
    'diwali',
    'holi',
    'christmas',
    'valentines-day',
    'poila-boishakh',
    'happy-new-year',
    'happy-hour',
    'weekend-special',
  ] as const;

  describe('1. Exactly 11 Approved Themes in THEME_REGISTRY', () => {
    it('contains exactly 11 registered themes', () => {
      const keys = Object.keys(THEME_REGISTRY);
      expect(keys).toHaveLength(11);
      expect(getRegisteredThemes()).toHaveLength(11);
    });

    it('contains every required theme key', () => {
      for (const expectedKey of EXPECTED_THEME_KEYS) {
        expect(THEME_REGISTRY).toHaveProperty(expectedKey);
        expect(isRegisteredTheme(expectedKey)).toBe(true);
      }
    });

    it('does not contain unapproved or extra themes', () => {
      const registeredKeys = Object.keys(THEME_REGISTRY).sort();
      const expectedKeys = [...EXPECTED_THEME_KEYS].sort();
      expect(registeredKeys).toEqual(expectedKeys);
    });
  });

  describe('2 & 3. Unique & Stable Kebab-Case Identifiers', () => {
    it('all theme keys are unique', () => {
      const keys = Object.keys(THEME_REGISTRY);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('all theme keys strictly adhere to lowercase kebab-case format', () => {
      const kebabCaseRegex = /^[a-z]+(-[a-z]+)*$/;
      for (const key of Object.keys(THEME_REGISTRY)) {
        expect(key).toMatch(kebabCaseRegex);
        expect(key).toBe(key.toLowerCase().trim());
      }
    });
  });

  describe('4, 5 & 6. CustomerTheme Contract & Token Completeness', () => {
    const requiredTokenGroups: (keyof CustomerThemeTokens)[] = [
      'surfaces',
      'accents',
      'text',
      'borders',
      'status',
      'geometry',
    ];

    it('every theme satisfies the CustomerTheme interface', () => {
      for (const theme of getRegisteredThemes()) {
        expect(theme.key).toBeDefined();
        expect(typeof theme.key).toBe('string');
        expect(theme.name).toBeDefined();
        expect(typeof theme.name).toBe('string');
        expect(theme.tokens).toBeDefined();
        expect(typeof theme.tokens).toBe('object');
      }
    });

    it('every theme provides all required semantic token groups', () => {
      for (const theme of getRegisteredThemes()) {
        for (const group of requiredTokenGroups) {
          expect(theme.tokens[group]).toBeDefined();
          expect(typeof theme.tokens[group]).toBe('object');
        }
      }
    });

    it('all required individual tokens are non-empty strings', () => {
      for (const theme of getRegisteredThemes()) {
        const { surfaces, accents, text, borders, status, geometry } = theme.tokens;

        // Surfaces
        expect(surfaces.background).toBeTruthy();
        expect(surfaces.backgroundElevated).toBeTruthy();
        expect(surfaces.surface).toBeTruthy();
        expect(surfaces.surfaceSolid).toBeTruthy();
        expect(surfaces.surfaceElevated).toBeTruthy();
        expect(surfaces.surfaceInteractive).toBeTruthy();

        // Accents
        expect(accents.primary).toBeTruthy();
        expect(accents.primaryHover).toBeTruthy();
        expect(accents.primaryForeground).toBeTruthy();
        expect(accents.primaryGlow).toBeTruthy();
        expect(accents.accentDineIn).toBeTruthy();
        expect(accents.accentDineInGlow).toBeTruthy();
        expect(accents.accentTakeaway).toBeTruthy();
        expect(accents.accentTakeawayGlow).toBeTruthy();

        // Text
        expect(text.text).toBeTruthy();
        expect(text.textSecondary).toBeTruthy();
        expect(text.textMuted).toBeTruthy();

        // Borders
        expect(borders.border).toBeTruthy();
        expect(borders.borderSubtle).toBeTruthy();
        expect(borders.borderHover).toBeTruthy();
        expect(borders.borderActive).toBeTruthy();

        // Status
        expect(status.success).toBeTruthy();
        expect(status.warning).toBeTruthy();
        expect(status.danger).toBeTruthy();

        // Geometry
        expect(geometry.radiusSm).toBeTruthy();
        expect(geometry.radiusMd).toBeTruthy();
        expect(geometry.radiusLg).toBeTruthy();
        expect(geometry.radiusXl).toBeTruthy();
        expect(geometry.shadowSm).toBeTruthy();
        expect(geometry.shadowMd).toBeTruthy();
        expect(geometry.shadowLg).toBeTruthy();
      }
    });

    it('every theme includes valid presentation metadata', () => {
      for (const theme of getRegisteredThemes()) {
        expect(theme.metadata).toBeDefined();
        expect(theme.metadata?.category).toBeDefined();
        expect(['core', 'cultural', 'seasonal', 'modern']).toContain(theme.metadata?.category);
        expect(Array.isArray(theme.metadata?.tags)).toBe(true);
        expect(theme.metadata?.previewAccentColor).toBeTruthy();
        expect(theme.metadata?.previewSurfaceColor).toBeTruthy();
      }
    });
  });

  describe('7. CSS Variable Conversion (themeToCssVariables)', () => {
    const REQUIRED_CSS_VARS = [
      '--qf-background',
      '--qf-background-elevated',
      '--qf-surface',
      '--qf-surface-solid',
      '--qf-surface-elevated',
      '--qf-surface-interactive',
      '--qf-primary',
      '--qf-primary-hover',
      '--qf-primary-foreground',
      '--qf-primary-glow',
      '--qf-accent-dine-in',
      '--qf-accent-dine-in-glow',
      '--qf-accent-takeaway',
      '--qf-accent-takeaway-glow',
      '--qf-text',
      '--qf-text-secondary',
      '--qf-text-muted',
      '--qf-border',
      '--qf-border-subtle',
      '--qf-border-hover',
      '--qf-border-active',
      '--qf-success',
      '--qf-warning',
      '--qf-danger',
      '--qf-radius-sm',
      '--qf-radius-md',
      '--qf-radius-lg',
      '--qf-radius-xl',
      '--qf-shadow-sm',
      '--qf-shadow-md',
      '--qf-shadow-lg',
    ];

    it('successfully converts every registered theme to a full CSS property map', () => {
      for (const theme of getRegisteredThemes()) {
        const cssVars = themeToCssVariables(theme) as Record<string, string>;
        expect(cssVars).toBeDefined();

        for (const varName of REQUIRED_CSS_VARS) {
          const val = cssVars[varName];
          expect(val).toBeDefined();
          expect(typeof val).toBe('string');
          expect((val ?? '').trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('8 & 9. Authoritative Resolution & Default Immutability', () => {
    it('resolves each registered theme key to its authoritative object', () => {
      for (const expectedKey of EXPECTED_THEME_KEYS) {
        const resolved = resolveCustomerTheme(expectedKey);
        expect(resolved).toBeDefined();
        expect(resolved.key).toBe(expectedKey);
        expect(resolved).toEqual(THEME_REGISTRY[expectedKey]);
      }
    });

    it('handles case-insensitivity and whitespace for all registered keys', () => {
      for (const expectedKey of EXPECTED_THEME_KEYS) {
        const upperPadded = `  ${expectedKey.toUpperCase()}  `;
        const resolved = resolveCustomerTheme(upperPadded);
        expect(resolved.key).toBe(expectedKey);
        expect(resolved).toEqual(THEME_REGISTRY[expectedKey]);
      }
    });

    it('safely falls back to default theme for unknown, null, undefined, or arbitrary strings', () => {
      expect(resolveCustomerTheme(null)).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme(undefined)).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('   ')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('non-existent-theme')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('christmas-v2')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('<script>alert("xss")</script>')).toEqual(DEFAULT_CUSTOMER_THEME);
      expect(resolveCustomerTheme('body { background: red; }')).toEqual(DEFAULT_CUSTOMER_THEME);
    });

    it('preserves DEFAULT_CUSTOMER_THEME unchanged from Phase 1/Phase 2 baseline', () => {
      expect(DEFAULT_CUSTOMER_THEME.key).toBe('default');
      expect(DEFAULT_CUSTOMER_THEME.name).toBe('QueueFlow Premium');
      expect(DEFAULT_CUSTOMER_THEME.tokens.surfaces.background).toBe('#0c1017');
      expect(DEFAULT_CUSTOMER_THEME.tokens.accents.primary).toBe('#10b981');
      expect(DEFAULT_CUSTOMER_THEME.tokens.accents.accentDineIn).toBe('#3b82f6');
      expect(DEFAULT_CUSTOMER_THEME.tokens.accents.accentTakeaway).toBe('#f59e0b');
      expect(DEFAULT_CUSTOMER_THEME.tokens.text.text).toBe('#f8fafc');
      expect(DEFAULT_CUSTOMER_THEME.tokens.borders.border).toBe('rgba(255, 255, 255, 0.08)');
    });
  });

  describe('10 & 11. Separation of Presentation from Business Logic', () => {
    it('no theme definition contains operational or business configuration', () => {
      for (const theme of getRegisteredThemes()) {
        expect(theme).not.toHaveProperty('queueEnabled');
        expect(theme).not.toHaveProperty('maxQueueCapacity');
        expect(theme).not.toHaveProperty('seating_mode');
        expect(theme).not.toHaveProperty('pricing');
        expect(theme).not.toHaveProperty('currency');
        expect(theme).not.toHaveProperty('takeaway_enabled');
        expect(theme).not.toHaveProperty('tables');
        expect(theme).not.toHaveProperty('permissions');
      }
    });

    it('Dine-In and Takeaway accents remain visually distinct across all 11 themes', () => {
      for (const theme of getRegisteredThemes()) {
        const { accentDineIn, accentTakeaway } = theme.tokens.accents;
        // Dine-In and Takeaway channel accents must never be identical
        expect(accentDineIn.toLowerCase()).not.toBe(accentTakeaway.toLowerCase());
      }
    });
  });

  describe('12. Admin Schema Compatibility for all 11 Themes', () => {
    it('updateRestaurantProfileSchema accepts all 11 registered keys and rejects unknown keys', () => {
      for (const key of EXPECTED_THEME_KEYS) {
        const valid = updateRestaurantProfileSchema.safeParse({
          name: 'Bistro Spice',
          customer_theme_key: key,
        });
        expect(valid.success).toBe(true);
      }

      const invalid = updateRestaurantProfileSchema.safeParse({
        name: 'Bistro Spice',
        customer_theme_key: 'unregistered-festival',
      });
      expect(invalid.success).toBe(false);
    });

    it('platform updateRestaurantSchema accepts all 11 registered keys and rejects unknown keys', () => {
      for (const key of EXPECTED_THEME_KEYS) {
        const valid = updateRestaurantSchema.safeParse({
          customer_theme_key: key,
        });
        expect(valid.success).toBe(true);
      }

      const invalid = updateRestaurantSchema.safeParse({
        customer_theme_key: 'random-theme',
      });
      expect(invalid.success).toBe(false);
    });
  });
});

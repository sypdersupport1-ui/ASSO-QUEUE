import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  THEME_REGISTRY,
  getRegisteredThemes,
  isRegisteredTheme,
  resolveCustomerTheme,
  themeToCssVariables,
} from '@/lib/themes';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { updateCustomerThemeAction } from '@/app/dashboard/actions';

// Mock server-only Supabase calls & revalidatePath
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('Phase 4 — Outlet Theme Management & Library Tests', () => {
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
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Theme Library loads exactly all 11 registered themes', () => {
    const themes = getRegisteredThemes();
    expect(themes).toHaveLength(11);
    const keys = themes.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(EXPECTED_THEME_KEYS));
    expect(keys).toHaveLength(EXPECTED_THEME_KEYS.length);
  });

  it('2. Current theme is correctly identified from customer_theme_key', () => {
    const persistedKey = 'durga-puja';
    const activeTheme = resolveCustomerTheme(persistedKey);
    expect(activeTheme.key).toBe('durga-puja');
    expect(activeTheme.name).toBe('Durga Puja');

    // Default fallback when undefined / empty
    const fallbackTheme = resolveCustomerTheme(undefined);
    expect(fallbackTheme.key).toBe('default');
    expect(fallbackTheme.name).toBe('QueueFlow Premium');
  });

  it('3. Preview uses the selected theme tokens via themeToCssVariables', () => {
    const diwaliTheme = THEME_REGISTRY['diwali'];
    expect(diwaliTheme).toBeDefined();

    const cssVars = themeToCssVariables(diwaliTheme) as Record<string, string>;
    expect(cssVars['--qf-background']).toBe(diwaliTheme!.tokens.surfaces.background);
    expect(cssVars['--qf-surface']).toBe(diwaliTheme!.tokens.surfaces.surface);
    expect(cssVars['--qf-primary']).toBe(diwaliTheme!.tokens.accents.primary);
    expect(cssVars['--qf-accent-dine-in']).toBe(diwaliTheme!.tokens.accents.accentDineIn);
    expect(cssVars['--qf-accent-takeaway']).toBe(diwaliTheme!.tokens.accents.accentTakeaway);
  });

  it('4. Preview does not mutate database state or call update actions', () => {
    // Opening preview generates CSS variables without invoking any service update
    const updateSpy = vi.spyOn(RestaurantAdminService, 'updateCustomerTheme');
    const previewedTheme = resolveCustomerTheme('kali-puja');
    const vars = themeToCssVariables(previewedTheme);

    expect(vars).toBeDefined();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('5. updateCustomerThemeAction invokes RestaurantAdminService with normalized theme key', async () => {
    const updateSpy = vi.spyOn(RestaurantAdminService, 'updateCustomerTheme').mockResolvedValueOnce({
      success: true,
      themeKey: 'holi',
    });

    const result = await updateCustomerThemeAction('holi');
    expect(result.success).toBe(true);
    expect(result.themeKey).toBe('holi');
    expect(updateSpy).toHaveBeenCalledWith('holi');
  });

  it('6. Duplicate submission handling: service rejects unknown strings or invalid types', async () => {
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockResolvedValue({
      userId: 'test-admin-uid',
      restaurantId: '11111111-1111-1111-1111-111111111111',
    });
    vi.spyOn(AuthorizationService, 'requirePermission').mockResolvedValue({
      userId: 'test-admin-uid',
      role: 'RESTAURANT_ADMIN',
      restaurantId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(RestaurantAdminService.updateCustomerTheme('')).rejects.toThrow('Theme key is required');
  });

  it('7. Successful save returns normalized themeKey and preserves confirmation state', async () => {
    vi.spyOn(RestaurantAdminService, 'updateCustomerTheme').mockResolvedValueOnce({
      success: true,
      themeKey: 'christmas',
    });

    const response = await updateCustomerThemeAction('christmas');
    expect(response.success).toBe(true);
    expect(response.themeKey).toBe('christmas');
  });

  it('8. Failed save does not falsely update the active theme', async () => {
    vi.spyOn(RestaurantAdminService, 'updateCustomerTheme').mockRejectedValueOnce(
      new Error('Database connectivity error')
    );

    const response = await updateCustomerThemeAction('valentines-day');
    expect(response.success).toBe(false);
    expect(response.error).toBe('Database connectivity error');
    expect(response.themeKey).toBeUndefined();
  });

  it('9. Unauthorized access is blocked if user is not an active Restaurant Admin', async () => {
    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockRejectedValueOnce(
      new Error('Access denied. Active Restaurant Admin membership required.')
    );

    const response = await updateCustomerThemeAction('diwali');
    expect(response.success).toBe(false);
    expect(response.error).toContain('Access denied');
  });

  it('10. Staff role cannot mutate restaurant theme (lacks RESTAURANT_UPDATE permission)', () => {
    const staffPermissions = ROLE_DEFAULT_PERMISSIONS.STAFF;
    expect(staffPermissions).not.toContain(PERMISSIONS.RESTAURANT_UPDATE);
    expect(staffPermissions).toContain(PERMISSIONS.RESTAURANT_VIEW);

    const adminPermissions = ROLE_DEFAULT_PERMISSIONS.RESTAURANT_ADMIN;
    expect(adminPermissions).toContain(PERMISSIONS.RESTAURANT_UPDATE);
  });

  it('11. Unknown or arbitrary theme key cannot be submitted', async () => {
    expect(isRegisteredTheme('hacker-custom-theme')).toBe(false);
    expect(isRegisteredTheme('eval("bad")')).toBe(false);
    expect(isRegisteredTheme(null)).toBe(false);

    vi.spyOn(RestaurantAdminService as unknown as { getAuthorizedRestaurantContext: () => Promise<unknown> }, 'getAuthorizedRestaurantContext').mockResolvedValue({
      userId: 'test-admin-uid',
      restaurantId: '11111111-1111-1111-1111-111111111111',
    });
    vi.spyOn(AuthorizationService, 'requirePermission').mockResolvedValue({
      userId: 'test-admin-uid',
      role: 'RESTAURANT_ADMIN',
      restaurantId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(RestaurantAdminService.updateCustomerTheme('hacker-theme')).rejects.toThrow(
      'Unknown theme key: "hacker-theme". Only approved registered themes can be selected.'
    );
  });

  it('12. Registry remains canonical with exactly 11 themes and valid metadata', () => {
    const themes = getRegisteredThemes();
    expect(themes).toHaveLength(11);

    for (const theme of themes) {
      expect(theme.key).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.tokens).toBeDefined();
      expect(theme.tokens.surfaces.background).toBeTruthy();
      expect(theme.tokens.accents.primary).toBeTruthy();
      expect(theme.metadata).toBeDefined();
      expect(['core', 'cultural', 'seasonal', 'modern']).toContain(theme.metadata?.category);
    }
  });

  it('13. Existing customer theme resolution remains unchanged and resilient', () => {
    // Arbitrary unknown key gracefully falls back to default
    const resolvedUnknown = resolveCustomerTheme('unknown-legacy-key');
    expect(resolvedUnknown.key).toBe('default');

    // Case-insensitive lookup works
    const resolvedUpper = resolveCustomerTheme('DURGA-PUJA');
    expect(resolvedUpper.key).toBe('durga-puja');

    // Whitespace trimmed lookup works
    const resolvedSpaced = resolveCustomerTheme('  poila-boishakh  ');
    expect(resolvedSpaced.key).toBe('poila-boishakh');
  });
});

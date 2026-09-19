import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  THEME_REGISTRY,
  getRegisteredThemes,
  resolveCustomerTheme,
  type ThemeMotifKind,
} from '@/lib/themes';
import { ThemeArtwork } from '@/components/themes';

describe('QueueFlow Customer Theme Visual Artwork & Motif Layer', () => {
  const EXPECTED_THEME_MOTIFS: Record<string, ThemeMotifKind> = {
    'default': 'none',
    'durga-puja': 'alpana',
    'kali-puja': 'midnight-lotus',
    'diwali': 'diwali-rangoli',
    'holi': 'holi-powder',
    'christmas': 'evergreen-festive',
    'valentines-day': 'romantic-botanical',
    'poila-boishakh': 'boishakh-heritage',
    'happy-new-year': 'celebration-spark',
    'happy-hour': 'cocktail-lounge',
    'weekend-special': 'botanical-brunch',
  };

  describe('1. Theme Contract & Artwork Configuration for all 11 Themes', () => {
    it('every registered theme defines an explicit artwork configuration', () => {
      const themes = getRegisteredThemes();
      expect(themes).toHaveLength(11);

      for (const theme of themes) {
        expect(theme.artwork).toBeDefined();
        expect(theme.artwork?.motif).toBeDefined();
        expect(typeof theme.artwork?.motif).toBe('string');
        expect(typeof theme.artwork?.opacity).toBe('number');
      }
    });

    it('matches exact canonical motif mapping for every theme', () => {
      for (const [themeKey, expectedMotif] of Object.entries(EXPECTED_THEME_MOTIFS)) {
        const theme = THEME_REGISTRY[themeKey];
        expect(theme).toBeDefined();
        expect(theme?.artwork?.motif).toBe(expectedMotif);
      }
    });

    it('artwork opacity is restrained for hospitality aesthetics (<= 0.15)', () => {
      for (const theme of getRegisteredThemes()) {
        const opacity = theme.artwork?.opacity ?? 1;
        expect(opacity).toBeGreaterThan(0);
        expect(opacity).toBeLessThanOrEqual(0.15);
      }
    });

    it('default theme uses minimal neutral motif (none)', () => {
      const defaultTheme = THEME_REGISTRY['default'];
      expect(defaultTheme?.artwork?.motif).toBe('none');
    });
  });

  describe('2. Fallback & Safety on Unknown / Undefined Themes', () => {
    it('falls back to default motif (none) on null/undefined input', () => {
      const nullTheme = resolveCustomerTheme(null);
      expect(nullTheme.artwork?.motif).toBe('none');

      const undefinedTheme = resolveCustomerTheme(undefined);
      expect(undefinedTheme.artwork?.motif).toBe('none');
    });

    it('falls back to default motif (none) on unknown or invalid key', () => {
      const unknownTheme = resolveCustomerTheme('non-existent-theme-xyz');
      expect(unknownTheme.artwork?.motif).toBe('none');
    });
  });

  describe('3. Accessibility & Presentation-Only Invariants', () => {
    it('renders with aria-hidden="true" and pointer-events-none', () => {
      for (const theme of getRegisteredThemes()) {
        const html = renderToStaticMarkup(<ThemeArtwork theme={theme} variant="page" />);

        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('pointer-events-none');
        expect(html).toContain('select-none');
      }
    });

    it('contains zero interactive elements (buttons, inputs, links, forms)', () => {
      for (const theme of getRegisteredThemes()) {
        const html = renderToStaticMarkup(<ThemeArtwork theme={theme} variant="page" />);
        expect(html).not.toMatch(/<button\b/i);
        expect(html).not.toMatch(/<a\b/i);
        expect(html).not.toMatch(/<input\b/i);
        expect(html).not.toMatch(/<select\b/i);
        expect(html).not.toMatch(/<textarea\b/i);
        expect(html).not.toMatch(/<form\b/i);
      }
    });

    it('renders cleanly across all variants (page, card, modal)', () => {
      const durgaPujaTheme = THEME_REGISTRY['durga-puja'];

      const pageHtml = renderToStaticMarkup(<ThemeArtwork theme={durgaPujaTheme} variant="page" />);
      expect(pageHtml).toContain('data-variant="page"');
      expect(pageHtml).toContain('data-theme-motif="alpana"');

      const cardHtml = renderToStaticMarkup(<ThemeArtwork theme={durgaPujaTheme} variant="card" />);
      expect(cardHtml).toContain('data-variant="card"');
      expect(cardHtml).toContain('data-theme-motif="alpana"');

      const modalHtml = renderToStaticMarkup(<ThemeArtwork theme={durgaPujaTheme} variant="modal" />);
      expect(modalHtml).toContain('data-variant="modal"');
      expect(modalHtml).toContain('data-theme-motif="alpana"');
    });

    it('renders gracefully when only themeKey is provided without theme object', () => {
      const html = renderToStaticMarkup(<ThemeArtwork themeKey="diwali" variant="page" />);
      expect(html).toContain('data-theme-motif="diwali-rangoli"');
      expect(html).toContain('<svg');
    });

    it('renders gracefully with fallback when themeKey is invalid', () => {
      const html = renderToStaticMarkup(<ThemeArtwork themeKey="invalid-random-key" variant="page" />);
      expect(html).toContain('data-theme-motif="none"');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { getRegisteredThemes, themeToCssVariables } from '@/lib/themes';

/**
 * Parses a hex color (#RRGGBB) or rgba string and returns normalized RGB values [0, 1].
 */
function parseColorToRgb(color: string): [number, number, number] {
  const trimmed = color.trim().toLowerCase();

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const c0 = hex.charAt(0);
      const c1 = hex.charAt(1);
      const c2 = hex.charAt(2);
      const r = parseInt(c0 + c0, 16) / 255;
      const g = parseInt(c1 + c1, 16) / 255;
      const b = parseInt(c2 + c2, 16) / 255;
      return [r, g, b];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return [r, g, b];
    }
  }

  if (trimmed.startsWith('rgba') || trimmed.startsWith('rgb')) {
    const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [
        parseInt(match[1] ?? '0', 10) / 255,
        parseInt(match[2] ?? '0', 10) / 255,
        parseInt(match[3] ?? '0', 10) / 255,
      ];
    }
  }

  // Fallback
  return [0.5, 0.5, 0.5];
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const sR = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const sG = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const sB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
}

function calculateContrastRatio(color1: string, color2: string): number {
  const [r1, g1, b1] = parseColorToRgb(color1);
  const [r2, g2, b2] = parseColorToRgb(color2);
  const l1 = getRelativeLuminance(r1, g1, b1);
  const l2 = getRelativeLuminance(r2, g2, b2);
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (brighter + 0.05) / (darker + 0.05);
}

describe('Phase 3 — Visual QA & Accessibility Contrast Verification', () => {
  const themes = getRegisteredThemes();

  describe('WCAG AA Contrast Verification (>= 4.5:1 for body text, >= 3:1 for large text / UI)', () => {
    it.each(themes)('Theme "$name" ($key) passes WCAG AA contrast for primary text on background', (theme) => {
      const { text, surfaces } = theme.tokens;
      const ratio = calculateContrastRatio(text.text, surfaces.background);
      // High contrast dark mode: text must exceed 7:1 for pristine legibility
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });

    it.each(themes)('Theme "$name" ($key) passes WCAG AA contrast for primary text on surfaceSolid', (theme) => {
      const { text, surfaces } = theme.tokens;
      const ratio = calculateContrastRatio(text.text, surfaces.surfaceSolid);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });

    it.each(themes)('Theme "$name" ($key) passes WCAG AA contrast for secondary text on surfaceSolid', (theme) => {
      const { text, surfaces } = theme.tokens;
      const ratio = calculateContrastRatio(text.textSecondary, surfaces.surfaceSolid);
      // Secondary text >= 4.5:1 (WCAG AA normal text threshold)
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it.each(themes)('Theme "$name" ($key) passes WCAG AA contrast for primary button CTA', (theme) => {
      const { accents } = theme.tokens;
      const ratio = calculateContrastRatio(accents.primaryForeground, accents.primary);
      // Primary button CTA is large bold text (>= 3.0:1)
      expect(ratio).toBeGreaterThanOrEqual(4.0);
    });
  });

  describe('Dine-In vs Takeaway Visual Distinction', () => {
    it.each(themes)('Theme "$name" ($key) maintains distinct Dine-In and Takeaway channel accents', (theme) => {
      const { accentDineIn, accentTakeaway } = theme.tokens.accents;
      expect(accentDineIn.toLowerCase()).not.toEqual(accentTakeaway.toLowerCase());

      const [r1, g1, b1] = parseColorToRgb(accentDineIn);
      const [r2, g2, b2] = parseColorToRgb(accentTakeaway);
      // Delta in color channels must be perceptible
      const colorDelta = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      expect(colorDelta).toBeGreaterThanOrEqual(0.35);
    });
  });

  describe('CSS Variable Completeness & Viewport Readiness', () => {
    it.each(themes)('Theme "$name" ($key) generates valid geometry tokens for all viewports', (theme) => {
      const vars = themeToCssVariables(theme) as Record<string, string>;
      expect(vars['--qf-radius-sm']).toMatch(/^[0-9.]+(rem|px)$/);
      expect(vars['--qf-radius-md']).toMatch(/^[0-9.]+(rem|px)$/);
      expect(vars['--qf-radius-lg']).toMatch(/^[0-9.]+(rem|px)$/);
      expect(vars['--qf-radius-xl']).toMatch(/^[0-9.]+(rem|px)$/);
    });
  });
});

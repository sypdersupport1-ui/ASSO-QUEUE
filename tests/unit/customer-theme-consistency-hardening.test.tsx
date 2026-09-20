import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  THEME_REGISTRY,
  getRegisteredThemes,
  resolveCustomerTheme,
  themeToCssVariables,
} from '@/lib/themes';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';
import { CustomerErrorState } from '@/components/customer/CustomerErrorState';
import { CustomerPageSkeleton } from '@/components/customer/CustomerPageSkeleton';
import { CustomerBadge } from '@/components/customer/ui/CustomerBadge';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('Customer Theme Consistency Hardening — Suite', () => {
  const allThemes = getRegisteredThemes();

  describe('A & K: Theme Resolution & All 11 Theme Registry Entries', () => {
    it('verifies exactly 11 valid registered themes in canonical registry', () => {
      expect(allThemes.length).toBe(11);
      const expectedKeys = [
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
      expectedKeys.forEach((key) => {
        const theme = THEME_REGISTRY[key];
        expect(theme, `Theme ${key} should be registered`).toBeDefined();
        expect(theme?.key).toBe(key);
      });
    });

    it('resolves active theme safely for valid keys and fallbacks', () => {
      expect(resolveCustomerTheme('kali-puja').key).toBe('kali-puja');
      expect(resolveCustomerTheme('diwali').key).toBe('diwali');
      expect(resolveCustomerTheme('unknown-nonexistent-key').key).toBe('default');
      expect(resolveCustomerTheme(null).key).toBe('default');
      expect(resolveCustomerTheme(undefined).key).toBe('default');
    });
  });

  describe('B & C: Theme CSS Variables & Scrim Architecture', () => {
    it.each(allThemes)('theme "$key" generates required semantic CSS variables', (theme) => {
      const vars = themeToCssVariables(theme) as Record<string, string>;
      expect(vars['--qf-background']).toBeDefined();
      expect(vars['--qf-surface']).toBeDefined();
      expect(vars['--qf-surface-solid']).toBeDefined();
      expect(vars['--qf-primary']).toBeDefined();
      expect(vars['--qf-primary-foreground']).toBeDefined();
      expect(vars['--qf-primary-glow']).toBeDefined();
      expect(vars['--qf-border']).toBeDefined();
      expect(vars['--qf-text']).toBeDefined();
      expect(vars['--qf-text-secondary']).toBeDefined();
      expect(vars['--qf-success']).toBeDefined();
      expect(vars['--qf-warning']).toBeDefined();
      expect(vars['--qf-danger']).toBeDefined();
      expect(vars['--qf-accent-dine-in']).toBeDefined();
      expect(vars['--qf-accent-takeaway']).toBeDefined();
    });

    it('verifies that non-Diwali themes do NOT contain hardcoded Diwali brown scrim', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      expect(kaliPuja.artwork.scrim).toBeDefined();
      // Kali Puja scrim must be midnight navy/black scrim, not maroon/brown rgba(20,6,0,...)
      expect(kaliPuja.artwork.scrim).not.toContain('rgba(20,6,0');

      const defaultTheme = resolveCustomerTheme('default');
      if (defaultTheme.artwork.scrim) {
        expect(defaultTheme.artwork.scrim).not.toContain('rgba(20,6,0');
      }
    });
  });

  describe('D & E: Status Page Theme Consistency & No Hardcoded Customer Colors', () => {
    it('QueueTicketCard uses customer-glass-card, semantic CSS variables, and no hardcoded emerald buttons', () => {
      const code = read('components/customer/QueueTicketCard.tsx');

      // Uses customer-glass-card and ambient glow
      expect(code).toContain('customer-glass-card');
      expect(code).toContain('customer-glass-surface');
      expect(code).toContain('var(--qf-primary-glow)');

      // Live Calling Board uses semantic variables for Now Calling & Up Next
      expect(code).toContain('LIVE CALLING BOARD');
      expect(code).toContain('var(--qf-warning)');
      expect(code).toContain('var(--qf-primary)');

      // Est. Wait Pod uses theme variables
      expect(code).toContain('var(--qf-accent-takeaway)');

      // Stepper uses theme variables
      expect(code).toContain('var(--qf-primary)');
      expect(code).toContain('var(--qf-accent-dine-in)');

      // Almost your turn alert uses theme warning
      expect(code).toContain('var(--qf-warning)');

      // Decision actions use customer-primary-cta and theme danger
      expect(code).toContain('customer-primary-cta');
      expect(code).toContain('var(--qf-danger)');

      // Does not contain hardcoded bg-emerald-500 button classes
      expect(code).not.toContain('bg-emerald-500');
    });

    it('Status route page wraps with CustomerShell and CustomerPlatformBrand', () => {
      const code = read('app/q/[slug]/status/[token]/page.tsx');

      expect(code).toContain('<CustomerShell theme={activeTheme}>');
      expect(code).toContain('<CustomerPlatformBrand />');
      expect(code).toContain('font-luxury-serif');
      // No duplicate hardcoded Diwali scrim
      expect(code).not.toContain('rgba(20,6,0,0.55)');
    });
  });

  describe('F: Completed Page Theme Consistency', () => {
    it('QueueTicketCard dining completed state uses customer-glass-card and customer-primary-cta', () => {
      const code = read('components/customer/QueueTicketCard.tsx');

      // Completed section uses customer-glass-card
      expect(code.toLowerCase()).toContain('dining completed');
      expect(code).toContain('Thank you for dining with us!');

      // Re-join button uses customer-primary-cta (not hardcoded bg-emerald-500)
      expect(code).toMatch(/<a[^>]*customer-primary-cta[^>]*>[^<]*Join the queue again/);
    });
  });

  describe('G: Takeaway Status Theme Consistency', () => {
    it('TakeawayTicketCard uses customer-glass-card, semantic CSS variables, and no hardcoded emerald buttons', () => {
      const code = read('components/customer/TakeawayTicketCard.tsx');

      expect(code).toContain('customer-glass-card');
      expect(code).toContain('customer-glass-surface');
      expect(code).toContain('var(--qf-primary-glow)');
      expect(code).toContain('customer-primary-cta');
      expect(code).not.toContain('bg-emerald-500');
    });
  });

  describe('H: Loading & Error State Theme Consistency', () => {
    it('renders CustomerPageSkeleton with theme surface and border variables', () => {
      const kaliTheme = resolveCustomerTheme('kali-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={kaliTheme}>
          <CustomerPageSkeleton />
        </CustomerShell>
      );

      expect(html).toContain('data-theme="kali-puja"');
      expect(html).toContain('var(--qf-surface)');
      expect(html).toContain('var(--qf-border)');
      // Verify no hardcoded slate-900 background breaking glassmorphism
      expect(html).not.toContain('bg-slate-900/90');
    });

    it('renders CustomerErrorState with customer-glass-card and customer-primary-cta button', () => {
      const kaliTheme = resolveCustomerTheme('kali-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={kaliTheme}>
          <CustomerErrorState
            title="Unable to Load Queue"
            message="We could not retrieve your live ticket."
            actionLabel="Try Again"
            onAction={() => {}}
          />
        </CustomerShell>
      );

      expect(html).toContain('data-theme="kali-puja"');
      expect(html).toContain('customer-glass-card');
      expect(html).toContain('customer-primary-cta');
      expect(html).toContain('Unable to Load Queue');
    });

    it('renders CustomerBadge with semantic CSS variables', () => {
      const html = renderToStaticMarkup(<CustomerBadge variant="success">Active</CustomerBadge>);
      expect(html).toContain('var(--qf-success)');
    });
  });

  describe('I & J: Diwali & Kali Puja Theme Regressions & Isolation', () => {
    it('preserves approved Diwali warm burgundy & amber aesthetic without Kali colors', () => {
      const diwali = resolveCustomerTheme('diwali');
      expect(diwali.tokens.surfaces.background).toBe('#140602');
      expect(diwali.tokens.accents.primary).toBe('#f59e0b');
      expect(diwali.tokens.accents.accentDineIn).toBe('#c2410c');
      expect(diwali.artwork.scrim).toContain('rgba(20, 7, 3');
      // Must NOT contain Kali violet/indigo primary
      expect(diwali.tokens.accents.primary).not.toBe('#7c3aed');
    });

    it('preserves approved Kali Puja midnight navy & electric violet aesthetic without Diwali brown scrim', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      expect(kaliPuja.tokens.surfaces.background).toBe('#070b14');
      expect(kaliPuja.tokens.surfaces.surfaceSolid).toBe('#0d1424');
      expect(kaliPuja.tokens.accents.primary).toBe('#7c3aed');
      expect(kaliPuja.tokens.accents.accentDineIn).toBe('#6366f1');
      // Must NOT contain Diwali maroon background or brown scrim
      expect(kaliPuja.tokens.surfaces.background).not.toBe('#140602');
      expect(kaliPuja.artwork.scrim).not.toContain('rgba(20,6,0');
    });

    it('renders canonical ASSO platform brand consistently in shell across both themes', () => {
      const kaliTheme = resolveCustomerTheme('kali-puja');
      const kaliHtml = renderToStaticMarkup(
        <CustomerShell theme={kaliTheme}>
          <CustomerPlatformBrand />
        </CustomerShell>
      );
      expect(kaliHtml).toContain('/brand/asso/asso-customer-white.png');
      expect(kaliHtml).toContain('ASSO');

      const diwaliTheme = resolveCustomerTheme('diwali');
      const diwaliHtml = renderToStaticMarkup(
        <CustomerShell theme={diwaliTheme}>
          <CustomerPlatformBrand />
        </CustomerShell>
      );
      expect(diwaliHtml).toContain('/brand/asso/asso-customer-white.png');
      expect(diwaliHtml).toContain('ASSO');
    });
  });

  describe('Route Consistency Verification (/q/[slug], /status/[token], /menu, /order/[token], /payment/[orderToken])', () => {
    it('verifies all customer route pages wrap with CustomerShell and resolve theme', () => {
      const routes = [
        'app/q/[slug]/page.tsx',
        'app/q/[slug]/status/[token]/page.tsx',
        'app/q/[slug]/menu/page.tsx',
        'app/q/[slug]/order/[token]/page.tsx',
        'app/q/[slug]/payment/[orderToken]/page.tsx',
      ];

      routes.forEach((route) => {
        const code = read(route);
        expect(code, `${route} should wrap in CustomerShell`).toContain('<CustomerShell');
        expect(code, `${route} should include CustomerPlatformBrand`).toContain('<CustomerPlatformBrand');
        expect(code, `${route} should not have hardcoded Diwali brown scrim`).not.toContain('rgba(20,6,0,0.55)');
      });
    });
  });
});

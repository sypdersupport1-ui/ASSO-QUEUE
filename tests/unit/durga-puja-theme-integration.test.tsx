import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import {
  THEME_REGISTRY,
  resolveCustomerTheme,
  themeToCssVariables,
} from '@/lib/themes';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { QueueStatusCard } from '@/components/customer/QueueStatusCard';
import { HospitalityFeatureRow } from '@/components/customer/HospitalityFeatureRow';
import { SignatureDishesCard } from '@/components/customer/SignatureDishesCard';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';

const MOCK_DURGA_PUJA_RESTAURANT: PublicRestaurantInfo = {
  id: '25516c44-9f33-4752-9c05-419633d5ba66',
  name: 'Biriyani House',
  slug: 'biriyani-house',
  description: 'Good Food. Brighter Days.',
  phone: '+91 98765 43210',
  address: '12 Park Street',
  city: 'Kolkata',
  logoUrl: 'https://example.com/logo.png', // Logo present in DB but MUST NOT be rendered
  queueEnabled: true,
  queueOperatingState: 'OPEN',
  maxQueueCapacity: 50,
  minPartySize: 1,
  maxPartySize: 10,
  callTimeoutMinutes: 5,
  status: 'ACTIVE',
  currency: 'INR',
  avgServiceTimeMins: 15,
  serviceCapacityUnits: 3,
  etaBufferMins: 5,
  takeawayEnabled: true,
  dineInCustomerOrderingEnabled: true,
  dineInStaffOrderingEnabled: true,
  takeawayCustomerOrderingEnabled: true,
  takeawayStaffOrderingEnabled: true,
  takeawayManualOrderingEnabled: false,
  customerThemeKey: 'durga-puja',
};

describe('QueueFlow — Durga Puja Theme Visual Integration', () => {
  describe('1. Durga Puja Theme Registration & Token Resolution', () => {
    it('registers durga-puja in canonical THEME_REGISTRY', () => {
      const durgaPuja = THEME_REGISTRY['durga-puja'];
      expect(durgaPuja).toBeDefined();
      expect(durgaPuja!.key).toBe('durga-puja');
      expect(durgaPuja!.name).toBe('Durga Puja');
    });

    it('resolves durga-puja theme by key and case-insensitively', () => {
      const resolved = resolveCustomerTheme('durga-puja');
      expect(resolved.key).toBe('durga-puja');

      const upperResolved = resolveCustomerTheme('DURGA-PUJA');
      expect(upperResolved.key).toBe('durga-puja');

      const paddedResolved = resolveCustomerTheme('  durga-puja  ');
      expect(paddedResolved.key).toBe('durga-puja');
    });

    it('defines oxblood foundations, wine glass surfaces, and radiant antique gold/vermilion accents', () => {
      const durgaPuja = resolveCustomerTheme('durga-puja');
      const { surfaces, accents, borders, text } = durgaPuja.tokens;

      // Dark translucent oxblood/wine glass
      expect(surfaces.background).toBe('#160406');
      expect(surfaces.surface).toContain('rgba');
      expect(surfaces.surfaceSolid).toBe('#24090d');

      // Radiant antique gold & festive vermilion
      expect(accents.primary).toBe('#b91c1c');
      expect(accents.primaryForeground).toBe('#fffbf2');
      expect(accents.accentDineIn).toBe('#dc2626');
      expect(accents.accentTakeaway).toBe('#f59e0b');

      // Subtle antique gold borders
      expect(borders.border).toContain('245, 158, 11');

      // High contrast text
      expect(text.text).toBe('#fffbf2');
      expect(text.textSecondary).toBe('#e8d7c5');
    });

    it('maps all durga-puja tokens to CSS custom properties (--qf-*)', () => {
      const durgaPuja = resolveCustomerTheme('durga-puja');
      const cssVars = themeToCssVariables(durgaPuja) as Record<string, string>;

      expect(cssVars['--qf-background']).toBe('#160406');
      expect(cssVars['--qf-primary']).toBe('#b91c1c');
      expect(cssVars['--qf-primary-foreground']).toBe('#fffbf2');
      expect(cssVars['--qf-accent-dine-in']).toBe('#dc2626');
      expect(cssVars['--qf-accent-takeaway']).toBe('#f59e0b');
      expect(cssVars['--qf-border']).toBeDefined();
    });
  });

  describe('2. Durga Puja Background Asset & Scrim Architecture', () => {
    it('verifies that durga-puja-bg.jpg exists in /public/themes/', () => {
      const publicPath = path.resolve(process.cwd(), 'public/themes/durga-puja-bg.jpg');
      expect(fs.existsSync(publicPath), 'durga-puja-bg.jpg must exist in public/themes/').toBe(true);
    });

    it('configures backgroundImage and custom warm burgundy scrim in theme artwork', () => {
      const durgaPuja = resolveCustomerTheme('durga-puja');
      expect(durgaPuja.artwork?.backgroundImage).toBe('/themes/durga-puja-bg.jpg');
      expect(durgaPuja.artwork?.scrim).toBeDefined();
      expect(durgaPuja.artwork?.scrim).toContain('linear-gradient');
      expect(durgaPuja.artwork?.scrim).toContain('rgba(22, 4, 6');
    });
  });

  describe('3. Canonical Shell & Header Rendering with Durga Puja', () => {
    it('renders CustomerShell with data-theme="durga-puja" and background layers', () => {
      const theme = resolveCustomerTheme('durga-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <div data-testid="content">Durga Shell Test</div>
        </CustomerShell>
      );

      expect(html).toContain('data-theme="durga-puja"');
      expect(html).toContain('/themes/durga-puja-bg.jpg');
      expect(html).toContain('Durga Shell Test');
    });

    it('renders official ASSO branding untouched in Durga Puja shell', () => {
      const theme = resolveCustomerTheme('durga-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <CustomerPlatformBrand />
        </CustomerShell>
      );

      expect(html).toContain('/brand/asso/asso-customer-white.png');
      expect(html).toContain('ASSO');
    });

    it('renders restaurant name with luxury serif typography', () => {
      const theme = resolveCustomerTheme('durga-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <RestaurantHeader restaurant={MOCK_DURGA_PUJA_RESTAURANT} waitingCount={0} />
        </CustomerShell>
      );

      expect(html).toContain('Biriyani House');
      expect(html).toContain('font-luxury-serif');
      expect(html).toContain('uppercase');
      // Logo URL must NOT be rendered
      expect(html).not.toContain('https://example.com/logo.png');
    });
  });

  describe('4. Component Theme Token Consumption', () => {
    it('renders QueueStatusCard using customer-glass-status and semantic tokens', () => {
      const theme = resolveCustomerTheme('durga-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <QueueStatusCard
            state="OPEN"
            waitingCount={0}
            waitLabel="No wait"
          />
        </CustomerShell>
      );

      expect(html).toContain('customer-glass-status');
      expect(html).toContain('No wait right now');
      expect(html).toContain('var(--qf-success)');
    });

    it('renders HospitalityFeatureRow and SignatureDishesCard with Durga Puja glass surfaces', () => {
      const theme = resolveCustomerTheme('durga-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <HospitalityFeatureRow />
          <SignatureDishesCard slug="biriyani-house" categories={[]} />
        </CustomerShell>
      );

      expect(html).toContain('customer-glass-surface');
      expect(html).toContain('customer-glass-card');
      expect(html).toContain('Live Updates');
      expect(html).toContain('Our Signature Dishes');
      expect(html).toContain('Chef Selection');
    });
  });

  describe('5. Theme Isolation & Non-Regression', () => {
    it('preserves approved Diwali warm mahogany & amber aesthetic without Durga colors', () => {
      const diwali = resolveCustomerTheme('diwali');
      expect(diwali.tokens.surfaces.background).toBe('#140602');
      expect(diwali.tokens.accents.primary).toBe('#f59e0b');
      expect(diwali.tokens.accents.accentDineIn).toBe('#c2410c');
      expect(diwali.artwork?.backgroundImage).toBe('/themes/diwali-bg.jpg');
    });

    it('preserves approved Kali Puja midnight navy & electric violet aesthetic without Durga colors', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      expect(kaliPuja.tokens.surfaces.background).toBe('#070b14');
      expect(kaliPuja.tokens.accents.primary).toBe('#7c3aed');
      expect(kaliPuja.tokens.accents.accentDineIn).toBe('#6366f1');
      expect(kaliPuja.artwork?.backgroundImage).toBe('/themes/kali-puja-bg.jpg');
    });
  });
});

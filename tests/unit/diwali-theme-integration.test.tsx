import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import {
  THEME_REGISTRY,
  getRegisteredThemes,
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

const MOCK_DIWALI_RESTAURANT: PublicRestaurantInfo = {
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
  customerThemeKey: 'diwali',
};

describe('QueueFlow — Diwali Theme Visual Integration', () => {
  describe('1. Diwali Theme Registration & Token Resolution', () => {
    it('registers diwali in canonical THEME_REGISTRY', () => {
      const diwali = THEME_REGISTRY['diwali'];
      expect(diwali).toBeDefined();
      expect(diwali!.key).toBe('diwali');
      expect(diwali!.name).toBe('Diwali');
    });

    it('resolves diwali theme by key and case-insensitively', () => {
      const resolved = resolveCustomerTheme('diwali');
      expect(resolved.key).toBe('diwali');

      const upperResolved = resolveCustomerTheme('DIWALI');
      expect(upperResolved.key).toBe('diwali');

      const paddedResolved = resolveCustomerTheme('  diwali  ');
      expect(paddedResolved.key).toBe('diwali');
    });

    it('defines warm-brown translucent glass surfaces and burnished gold accents', () => {
      const diwali = resolveCustomerTheme('diwali');
      const { surfaces, accents, borders, text } = diwali.tokens;

      // Dark translucent warm-brown glass
      expect(surfaces.background).toBe('#140602');
      expect(surfaces.surface).toContain('rgba');
      expect(surfaces.surfaceSolid).toBe('#1c0c05');

      // Warm golden amber CTA
      expect(accents.primary).toBe('#f59e0b');
      expect(accents.primaryForeground).toBe('#140602');
      expect(accents.accentDineIn).toBe('#c2410c');
      expect(accents.accentTakeaway).toBe('#f59e0b');

      // Burnished gold borders
      expect(borders.border).toContain('234, 179, 8');

      // High contrast text
      expect(text.text).toBe('#fff9f0');
      expect(text.textSecondary).toBe('#edd7be');
    });

    it('maps all diwali tokens to CSS custom properties (--qf-*)', () => {
      const diwali = resolveCustomerTheme('diwali');
      const cssVars = themeToCssVariables(diwali) as Record<string, string>;

      expect(cssVars['--qf-background']).toBe('#140602');
      expect(cssVars['--qf-primary']).toBe('#f59e0b');
      expect(cssVars['--qf-primary-foreground']).toBe('#140602');
      expect(cssVars['--qf-accent-dine-in']).toBe('#c2410c');
      expect(cssVars['--qf-accent-takeaway']).toBe('#f59e0b');
      expect(cssVars['--qf-text']).toBe('#fff9f0');
    });
  });

  describe('2. Background Asset & Scrim Integration', () => {
    it('defines local static background asset and custom warm readability scrim', () => {
      const diwali = resolveCustomerTheme('diwali');
      expect(diwali.artwork).toBeDefined();
      expect(diwali.artwork?.backgroundImage).toBe('/themes/diwali-bg.jpg');
      expect(diwali.artwork?.scrim).toBeDefined();
      expect(diwali.artwork?.scrim).toContain('linear-gradient');
      expect(diwali.artwork?.scrim).toContain('rgba(20, 7, 3');
    });

    it('static background asset exists in public directory and is optimized (< 500KB)', () => {
      const publicPath = path.join(process.cwd(), 'public', 'themes', 'diwali-bg.jpg');
      expect(fs.existsSync(publicPath)).toBe(true);

      const stats = fs.statSync(publicPath);
      expect(stats.size).toBeGreaterThan(50 * 1024); // Non-empty image (> 50KB)
      expect(stats.size).toBeLessThan(500 * 1024); // Optimized (< 500KB)
    });

    it('renders background image and scrim as fixed non-blocking layers in CustomerShell', () => {
      const diwali = resolveCustomerTheme('diwali');
      const html = renderToStaticMarkup(
        <CustomerShell theme={diwali}>
          <div>Diwali Customer Content</div>
        </CustomerShell>
      );

      // Background image layer
      expect(html).toContain('src="/themes/diwali-bg.jpg"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('pointer-events-none');
      expect(html).toContain('fixed inset-0');
      expect(html).toContain('object-cover');

      // Scrim layer
      expect(html).toContain('background:linear-gradient');
      expect(html).toContain('rgba(20, 7, 3');

      // Content sits above background
      expect(html).toContain('Diwali Customer Content');
    });
  });

  describe('3. Fallback Behavior & Multi-Theme Isolation', () => {
    it('falls back cleanly to default theme when key is invalid or null', () => {
      const nullTheme = resolveCustomerTheme(null);
      expect(nullTheme.key).toBe('default');
      expect(nullTheme.artwork?.backgroundImage).toBeUndefined();

      const invalidTheme = resolveCustomerTheme('non-existent-theme-xyz');
      expect(invalidTheme.key).toBe('default');
    });

    it('CustomerShell renders graceful ambient fallback when background image is absent', () => {
      const defaultTheme = resolveCustomerTheme('default');
      const html = renderToStaticMarkup(
        <CustomerShell theme={defaultTheme}>
          <div>Default Content</div>
        </CustomerShell>
      );

      // No image tag for default theme
      expect(html).not.toContain('<img');
      expect(html).toContain('Default Content');
      expect(html).toContain('qf-bg');
    });

    it('preserves all other 10 themes in THEME_REGISTRY without modification', () => {
      const themes = getRegisteredThemes();
      expect(themes).toHaveLength(11);

      const expectedOtherKeys = [
        'default',
        'durga-puja',
        'kali-puja',
        'holi',
        'christmas',
        'valentines-day',
        'poila-boishakh',
        'happy-new-year',
        'happy-hour',
        'weekend-special',
      ];

      for (const key of expectedOtherKeys) {
        const theme = THEME_REGISTRY[key];
        expect(theme).toBeDefined();
        expect(theme!.key).toBe(key);
      }
    });
  });

  describe('4. Canonical Mobile Layout Preservation & Accessibility Invariants', () => {
    it('renders all canonical components under Diwali theme with NO restaurant logo', () => {
      const diwali = resolveCustomerTheme('diwali');
      const html = renderToStaticMarkup(
        <CustomerShell theme={diwali}>
          <CustomerPlatformBrand />
          <RestaurantHeader restaurant={MOCK_DIWALI_RESTAURANT} waitingCount={2} />
          <QueueStatusCard state="OPEN" waitingCount={2} waitLabel="~15 mins" />
          <HospitalityFeatureRow />
          <SignatureDishesCard slug="biriyani-house" categories={[]} />
        </CustomerShell>
      );

      // 1. Platform Brand (Official ASSO logo in top-left position)
      expect(html).toContain('src="/brand/asso/asso-customer-white.png"');
      expect(html).toMatch(/alt="ASSO — Business Management (&amp;|&) Q"/);
      expect(html).toContain('justify-start');

      // 2. Restaurant Hero
      expect(html).toContain('Biriyani House');
      expect(html).toContain('Good Food. Brighter Days.');
      // Crucial: Restaurant logo must NOT be rendered
      expect(html).not.toContain('https://example.com/logo.png');

      // 3. Queue Status
      expect(html).toContain('2 parties waiting in line');
      expect(html).toContain('Estimated wait: ~15 mins');

      // 4. Feature row
      expect(html).toContain('Live Updates');
      expect(html).toContain('Authentic Flavours');
      expect(html).toContain('Warm Hospitality');

      // 5. Signature Dishes
      expect(html).toContain('Our Signature Dishes');

      // 6. Footer
      expect(html).toContain('Food Brings Us Closer');
      expect(html).toContain('Powered by');
    });

    it('theme motif has aria-hidden="true" and decorative-only semantics', () => {
      const diwali = resolveCustomerTheme('diwali');
      const html = renderToStaticMarkup(
        <CustomerShell theme={diwali}>
          <div>Accessible Shell</div>
        </CustomerShell>
      );

      expect(html).toContain('data-theme="diwali"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('pointer-events-none');
    });
  });
});

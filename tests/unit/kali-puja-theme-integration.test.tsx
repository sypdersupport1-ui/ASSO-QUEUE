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

const MOCK_KALI_PUJA_RESTAURANT: PublicRestaurantInfo = {
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
  customerThemeKey: 'kali-puja',
};

describe('QueueFlow — Kali Puja Theme Visual Integration', () => {
  describe('1. Kali Puja Theme Registration & Token Resolution', () => {
    it('registers kali-puja in canonical THEME_REGISTRY', () => {
      const kaliPuja = THEME_REGISTRY['kali-puja'];
      expect(kaliPuja).toBeDefined();
      expect(kaliPuja!.key).toBe('kali-puja');
      expect(kaliPuja!.name).toBe('Kali Puja');
    });

    it('resolves kali-puja theme by key and case-insensitively', () => {
      const resolved = resolveCustomerTheme('kali-puja');
      expect(resolved.key).toBe('kali-puja');

      const upperResolved = resolveCustomerTheme('KALI-PUJA');
      expect(upperResolved.key).toBe('kali-puja');

      const paddedResolved = resolveCustomerTheme('  kali-puja  ');
      expect(paddedResolved.key).toBe('kali-puja');
    });

    it('defines midnight indigo glass surfaces and luminous violet/indigo accents', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      const { surfaces, accents, borders, text } = kaliPuja.tokens;

      // Dark translucent midnight indigo glass
      expect(surfaces.background).toBe('#070b14');
      expect(surfaces.surface).toContain('rgba');
      expect(surfaces.surfaceSolid).toBe('#0d1424');

      // Luminous electric violet/indigo CTA
      expect(accents.primary).toBe('#7c3aed');
      expect(accents.primaryForeground).toBe('#ffffff');
      expect(accents.accentDineIn).toBe('#6366f1');
      expect(accents.accentTakeaway).toBe('#f59e0b');

      // Subtle violet/indigo borders
      expect(borders.border).toContain('129, 140, 248');

      // High contrast text
      expect(text.text).toBe('#fff9f0');
      expect(text.textSecondary).toBe('#cbd5e1');
    });

    it('maps all kali-puja tokens to CSS custom properties (--qf-*)', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      const cssVars = themeToCssVariables(kaliPuja) as Record<string, string>;

      expect(cssVars['--qf-background']).toBe('#070b14');
      expect(cssVars['--qf-primary']).toBe('#7c3aed');
      expect(cssVars['--qf-primary-foreground']).toBe('#ffffff');
      expect(cssVars['--qf-accent-dine-in']).toBe('#6366f1');
      expect(cssVars['--qf-accent-takeaway']).toBe('#f59e0b');
      expect(cssVars['--qf-text']).toBe('#fff9f0');
      expect(cssVars['--qf-text-secondary']).toBe('#cbd5e1');
    });
  });

  describe('2. Background Asset & Scrim Integration', () => {
    it('defines local static background asset and custom midnight readability scrim', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      expect(kaliPuja.artwork).toBeDefined();
      expect(kaliPuja.artwork?.backgroundImage).toBe('/themes/kali-puja-bg.jpg');
      expect(kaliPuja.artwork?.scrim).toBeDefined();
      expect(kaliPuja.artwork?.scrim).toContain('linear-gradient');
      expect(kaliPuja.artwork?.scrim).toContain('rgba(7, 11, 20');
    });

    it('static background asset exists in public directory and is optimized (< 500KB)', () => {
      const publicPath = path.join(process.cwd(), 'public', 'themes', 'kali-puja-bg.jpg');
      expect(fs.existsSync(publicPath)).toBe(true);

      const stats = fs.statSync(publicPath);
      expect(stats.size).toBeGreaterThan(50 * 1024); // Non-empty image (> 50KB)
      expect(stats.size).toBeLessThan(500 * 1024); // Optimized (< 500KB)
    });

    it('renders background image and scrim as fixed non-blocking layers in CustomerShell', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={kaliPuja}>
          <div>Kali Puja Customer Content</div>
        </CustomerShell>
      );

      // Background image layer
      expect(html).toContain('src="/themes/kali-puja-bg.jpg"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('pointer-events-none');
      expect(html).toContain('fixed inset-0');
      expect(html).toContain('object-cover');

      // Scrim layer
      expect(html).toContain('background:linear-gradient');
      expect(html).toContain('rgba(7, 11, 20');

      // Content sits above background
      expect(html).toContain('Kali Puja Customer Content');
    });
  });

  describe('3. Strict Isolation: Diwali Unchanged & Multi-Theme Preservation', () => {
    it('preserves Diwali theme tokens and background without regression', () => {
      const diwali = resolveCustomerTheme('diwali');
      expect(diwali.key).toBe('diwali');
      expect(diwali.tokens.surfaces.background).toBe('#140602');
      expect(diwali.tokens.accents.primary).toBe('#f59e0b');
      expect(diwali.tokens.accents.primaryForeground).toBe('#140602');
      expect(diwali.artwork?.backgroundImage).toBe('/themes/diwali-bg.jpg');

      const diwaliBgPath = path.join(process.cwd(), 'public', 'themes', 'diwali-bg.jpg');
      expect(fs.existsSync(diwaliBgPath)).toBe(true);
    });

    it('preserves all 11 themes in THEME_REGISTRY', () => {
      const themes = getRegisteredThemes();
      expect(themes).toHaveLength(11);

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

      for (const key of expectedKeys) {
        const theme = THEME_REGISTRY[key];
        expect(theme).toBeDefined();
        expect(theme!.key).toBe(key);
      }
    });
  });

  describe('4. Canonical Mobile Layout Preservation & Accessibility Invariants', () => {
    it('renders all canonical components under Kali Puja theme with NO restaurant logo', () => {
      const kaliPuja = resolveCustomerTheme('kali-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={kaliPuja}>
          <CustomerPlatformBrand />
          <RestaurantHeader restaurant={MOCK_KALI_PUJA_RESTAURANT} waitingCount={2} />
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
      const kaliPuja = resolveCustomerTheme('kali-puja');
      const html = renderToStaticMarkup(
        <CustomerShell theme={kaliPuja}>
          <div>Accessible Shell</div>
        </CustomerShell>
      );

      expect(html).toContain('data-theme="kali-puja"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('pointer-events-none');
    });
  });
});

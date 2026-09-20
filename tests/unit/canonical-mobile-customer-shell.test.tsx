import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerPlatformBrand } from '@/components/customer/CustomerPlatformBrand';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { QueueStatusCard } from '@/components/customer/QueueStatusCard';
import { HospitalityFeatureRow } from '@/components/customer/HospitalityFeatureRow';
import { SignatureDishesCard } from '@/components/customer/SignatureDishesCard';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { resolveCustomerTheme } from '@/lib/themes';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';

const MOCK_RESTAURANT: PublicRestaurantInfo = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Biriyani House',
  slug: 'biriyani-house',
  description: 'Good Food. Brighter Days.',
  phone: '+91 98765 43210',
  address: '12 Park Street',
  city: 'Kolkata',
  logoUrl: 'https://example.com/logo.png', // Provided in data but must NOT be rendered in canonical header
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
  customerThemeKey: 'default',
};

describe('QueueFlow Canonical Mobile Customer Shell', () => {
  describe('1. Platform Brand Placement', () => {
    it('renders the official ASSO logo in top-left position with black background and accessible alt text', () => {
      const html = renderToStaticMarkup(<CustomerPlatformBrand />);
      expect(html).toContain('src="/brand/asso/asso-customer-white.png"');
      expect(html).toMatch(/alt="ASSO — Business Management (&amp;|&) Q"/);
      expect(html).toContain('justify-start'); // Strictly TOP-LEFT aligned
      expect(html).toContain('bg-black');
      expect(html).not.toContain('aria-hidden="true"');
    });
  });

  describe('2 & 3. Restaurant Hero & Optional Tagline', () => {
    it('renders restaurant name prominently with tagline and NO restaurant logo', () => {
      const html = renderToStaticMarkup(
        <RestaurantHeader restaurant={MOCK_RESTAURANT} waitingCount={0} />
      );
      expect(html).toContain('Biriyani House');
      expect(html).toContain('uppercase');
      expect(html).toContain('Good Food. Brighter Days.');
      expect(html).not.toContain('<img'); // Strictly NO restaurant logo
      expect(html).toContain('line-clamp-2');
      expect(html).toContain('break-words');
    });
  });

  describe('4. Glass Status Card', () => {
    it('renders live queue status in customer-glass-status surface', () => {
      const html = renderToStaticMarkup(
        <QueueStatusCard state="OPEN" waitingCount={0} waitLabel={null} />
      );
      expect(html).toContain('customer-glass-status');
      expect(html).toContain('No wait right now');
      expect(html).toContain('Great time to dine!');
    });

    it('renders waiting party depth with live indicator', () => {
      const html = renderToStaticMarkup(
        <QueueStatusCard state="OPEN" waitingCount={3} waitLabel="~20 mins" />
      );
      expect(html).toContain('customer-glass-status');
      expect(html).toContain('3 parties waiting in line');
      expect(html).toContain('Estimated wait: ~20 mins');
    });
  });

  describe('5. Hospitality Feature Row', () => {
    it('renders the 3 compact reassurance items with icons', () => {
      const html = renderToStaticMarkup(<HospitalityFeatureRow />);
      expect(html).toContain('Live Updates');
      expect(html).toContain('Real-time status');
      expect(html).toContain('Authentic Flavours');
      expect(html).toContain('Memorable moments');
      expect(html).toContain('Warm Hospitality');
      expect(html).toContain('Always together');
      expect(html).toContain('customer-glass-surface');
    });
  });

  describe('6. Signature Dishes / Menu Entry Card', () => {
    it('renders compact menu discovery card linking to full menu', () => {
      const mockCategories = [
        {
          id: 'cat-1',
          name: 'Biriyani Specialties',
          description: null,
          items: [
            {
              id: 'item-1',
              name: 'Kolkata Dum Biriyani',
              description: 'Slow-cooked saffron rice with tender mutton',
              price: 340,
              available: true,
              image_url: 'https://example.com/biriyani.jpg',
            },
          ],
        },
      ];

      const html = renderToStaticMarkup(
        <SignatureDishesCard slug={MOCK_RESTAURANT.slug} categories={mockCategories} />
      );
      expect(html).toContain('Our Signature Dishes');
      expect(html).toContain('Explore our menu');
      expect(html).toContain('/q/biriyani-house/menu');
      expect(html).toContain('https://example.com/biriyani.jpg');
      expect(html).toContain('customer-glass-card');
    });

    it('gracefully falls back to culinary icon when no dish images exist', () => {
      const mockCategories = [
        {
          id: 'cat-1',
          name: 'Starters',
          description: null,
          items: [
            {
              id: 'item-1',
              name: 'Paneer Tikka',
              description: null,
              price: 220,
              available: true,
            },
          ],
        },
      ];

      const html = renderToStaticMarkup(
        <SignatureDishesCard slug={MOCK_RESTAURANT.slug} categories={mockCategories} />
      );
      expect(html).toContain('Our Signature Dishes');
      expect(html).toContain('Explore our menu');
      expect(html).not.toContain('<img');
    });
  });

  describe('7. CustomerShell 5-Layer Visual Architecture & Hospitality Footer', () => {
    it('renders canonical shell with safe-area insets, ambient layer, and hospitality footer', () => {
      const theme = resolveCustomerTheme('default');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <div>Test Content</div>
        </CustomerShell>
      );
      expect(html).toContain('Test Content');
      expect(html).toContain('Food Brings Us Closer');
      expect(html).toContain('✦');
      expect(html).toContain('Powered by');
      expect(html).toContain('QueueFlow');
      expect(html).toContain('env(safe-area-inset-bottom)');
      expect(html).toContain('env(safe-area-inset-top)');
    });

    it('supports theme background asset contract without hardcoded festival values', () => {
      const themeWithBg = {
        ...resolveCustomerTheme('default'),
        artwork: {
          motif: 'none' as const,
          backgroundImage: '/themes/test-bg.png',
        },
      };

      const html = renderToStaticMarkup(
        <CustomerShell theme={themeWithBg}>
          <div>Background Test</div>
        </CustomerShell>
      );
      expect(html).toContain('/themes/test-bg.png');
      expect(html).toContain('object-cover');
    });
  });
});

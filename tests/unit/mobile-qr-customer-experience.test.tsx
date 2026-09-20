import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerShell } from '@/components/customer/ui/CustomerShell';
import { CustomerInput } from '@/components/customer/ui/CustomerInput';
import { CustomerButton } from '@/components/customer/ui/CustomerButton';
import { ServiceSelector } from '@/components/customer/ServiceSelector';
import { PartySizeSelector } from '@/components/customer/PartySizeSelector';
import { RestaurantHeader } from '@/components/customer/RestaurantHeader';
import { QueueStatusCard } from '@/components/customer/QueueStatusCard';
import { ThemeArtwork } from '@/components/themes';
import { THEME_REGISTRY, resolveCustomerTheme } from '@/lib/themes';
import type { PublicRestaurantInfo } from '@/lib/services/public-restaurant-service';

const MOCK_RESTAURANT: PublicRestaurantInfo = {
  id: 'rest-uuid-1',
  name: 'The Royal Bengal Spice & Gourmet Tandoor Lounge',
  slug: 'royal-bengal',
  description: 'Heritage dining and craft tandoor dishes',
  queueEnabled: true,
  queueOperatingState: 'OPEN',
  maxQueueCapacity: 50,
  minPartySize: 1,
  maxPartySize: 12,
  callTimeoutMinutes: 5,
  status: 'ACTIVE',
  currency: 'INR',
  avgServiceTimeMins: 15,
  serviceCapacityUnits: 4,
  etaBufferMins: 5,
  takeawayEnabled: true,
  takeawayCustomerOrderingEnabled: true,
  takeawayStaffOrderingEnabled: true,
  takeawayManualOrderingEnabled: false,
  dineInCustomerOrderingEnabled: true,
  dineInStaffOrderingEnabled: true,
  address: '42 Park Street, Heritage District',
  city: 'Kolkata',
  phone: '+91 98765 43210',
  logoUrl: null,
  customerThemeKey: 'default',
};

describe('QueueFlow Mobile-First QR Customer Experience', () => {
  describe('1. Viewport & Safe-Area Engineering', () => {
    it('CustomerShell includes dynamic viewport height, overflow-x-hidden, and safe-area insets', () => {
      const theme = resolveCustomerTheme('default');
      const html = renderToStaticMarkup(
        <CustomerShell theme={theme}>
          <div data-testid="test-content">Content</div>
        </CustomerShell>
      );

      expect(html).toContain('min-h-[100dvh]');
      expect(html).toContain('overflow-x-hidden');
      // Safe-area top padding on content container
      expect(html).toContain('pt-[max(1.25rem,env(safe-area-inset-top))]');
      // Safe-area bottom padding on footer
      expect(html).toContain('pb-[max(1.5rem,env(safe-area-inset-bottom))]');
      expect(html).toContain('data-testid="test-content"');
    });

    it('Customer content column enforces mobile-first 100% width with max-w-md centered constraint for desktop', () => {
      const html = renderToStaticMarkup(
        <CustomerShell>
          <div>Child</div>
        </CustomerShell>
      );

      // Mobile: w-full with px-4 side gutters; Desktop: max-w-md mx-auto
      expect(html).toContain('w-full max-w-md');
      expect(html).toContain('px-4');
      expect(html).toContain('mx-auto');
    });
  });

  describe('2. iOS Safari Auto-Zoom Prevention & Input Ergonomics', () => {
    it('CustomerInput renders with text-base (16px) on mobile to prevent iOS Safari auto-zoom', () => {
      const html = renderToStaticMarkup(
        <CustomerInput
          id="test-name"
          name="name"
          label="Your Name"
          placeholder="Rahul Sharma"
        />
      );

      expect(html).toContain('text-base sm:text-sm');
      expect(html).toContain('h-12'); // 48px touch target height
    });

    it('CustomerInput includes accessible error and required indicators', () => {
      const html = renderToStaticMarkup(
        <CustomerInput
          id="test-input"
          label="Mobile Phone"
          required
          error="Please enter a valid phone number"
        />
      );

      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="test-input-error"');
      expect(html).toContain('Please enter a valid phone number');
    });
  });

  describe('3. Touch Target Guidelines (>= 44px - 48px)', () => {
    it('CustomerButton size lg has tactile touch target >= 52px and w-full mobile CTA styling', () => {
      const html = renderToStaticMarkup(
        <CustomerButton variant="primary" size="lg" className="w-full">
          Join Dine-In Queue
        </CustomerButton>
      );

      expect(html).toContain('min-h-[52px]');
      expect(html).toContain('w-full');
      expect(html).toContain('bg-[var(--qf-primary)]');
    });

    it('CustomerButton default size has tactile touch target >= 48px', () => {
      const html = renderToStaticMarkup(
        <CustomerButton variant="takeaway">
          Join Takeaway Queue
        </CustomerButton>
      );

      expect(html).toContain('min-h-[48px]');
      expect(html).toContain('bg-[var(--qf-accent-takeaway)]');
    });

    it('PartySizeSelector stepper buttons meet >= 44px touch target guidelines', () => {
      const html = renderToStaticMarkup(
        <PartySizeSelector
          value={3}
          min={1}
          max={10}
          onChange={() => {}}
        />
      );

      // Stepper buttons have h-11 w-11 (44px min)
      expect(html).toContain('h-11 w-11');
      expect(html).toContain('aria-label="Decrease party size by one"');
      expect(html).toContain('aria-label="Increase party size by one"');
      expect(html).toContain('aria-live="polite"');
    });

    it('ServiceSelector provides large tactile touch targets (min-h-[110px]) for Dine-In and Takeaway', () => {
      const html = renderToStaticMarkup(
        <ServiceSelector
          selectedService={null}
          onSelectService={() => {}}
        />
      );

      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('min-h-[110px]');
      expect(html).toContain('Dine-In');
      expect(html).toContain('Takeaway');
    });

    it('ServiceSelector clearly highlights active selection with distinct accent glows', () => {
      const htmlDineIn = renderToStaticMarkup(
        <ServiceSelector
          selectedService="DINE_IN"
          onSelectService={() => {}}
        />
      );
      expect(htmlDineIn).toContain('aria-checked="true"');
      expect(htmlDineIn).toContain('border-[var(--qf-accent-dine-in)]');

      const htmlTakeaway = renderToStaticMarkup(
        <ServiceSelector
          selectedService="TAKEAWAY"
          onSelectService={() => {}}
        />
      );
      expect(htmlTakeaway).toContain('aria-checked="true"');
      expect(htmlTakeaway).toContain('border-[var(--qf-accent-takeaway)]');
    });
  });

  describe('4. Mobile Brand Header & Long Name Wrapping', () => {
    it('RestaurantHeader wraps long names gracefully with line-clamp-2 break-words', () => {
      const html = renderToStaticMarkup(
        <RestaurantHeader restaurant={MOCK_RESTAURANT} waitingCount={2} />
      );

      expect(html).toContain('line-clamp-2');
      expect(html).toContain('break-words');
      expect(html).toContain('The Royal Bengal Spice &amp; Gourmet Tandoor Lounge');
      expect(html).toContain('2 parties waiting');
    });

    it('QueueStatusCard renders compact live status above the fold', () => {
      const html = renderToStaticMarkup(
        <QueueStatusCard
          state="OPEN"
          waitingCount={2}
          waitLabel="~15 mins"
        />
      );

      expect(html).toContain('2 parties waiting in line');
      expect(html).toContain('~15 mins');
    });
  });

  describe('5. Theme Artwork Mobile Non-Interference', () => {
    const allThemeKeys = Object.keys(THEME_REGISTRY);

    it.each(allThemeKeys)('Theme %s renders artwork behind content with pointer-events-none and overflow-hidden', (themeKey) => {
      const theme = resolveCustomerTheme(themeKey);
      const html = renderToStaticMarkup(
        <ThemeArtwork theme={theme} variant="page" />
      );

      expect(html).toContain('pointer-events-none');
      expect(html).toContain('absolute inset-0');
      expect(html).toContain('overflow-hidden');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-theme-motif="${theme.artwork?.motif || 'none'}"`);
    });
  });
});

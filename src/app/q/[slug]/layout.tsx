import React from 'react';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { resolveCustomerTheme, themeToCssVariables } from '@/lib/themes';

interface CustomerSlugLayoutProps {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

/**
 * Phase 2 — Server-First Customer Theme Layout.
 *
 * Resolves the restaurant's active customer presentation theme on the server
 * and injects canonical --qf-* semantic design tokens as CSS custom properties
 * at the root boundary of the /q/[slug] customer experience.
 *
 * Invariants:
 * 1. Resolves 100% on the server — no client fetching, no hydration mismatch, no FOUC.
 * 2. If restaurant not found or key invalid -> automatically falls back to QueueFlow Premium default theme.
 * 3. Future scheduling compatibility -> accepts effective theme key seamlessly in Phase 5.
 */
export default async function CustomerSlugLayout({
  params,
  children,
}: CustomerSlugLayoutProps) {
  const { slug } = await params;

  let customerThemeKey: string | null = null;
  try {
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(slug);
    customerThemeKey = restaurant?.customerThemeKey ?? null;
  } catch {
    customerThemeKey = null;
  }

  const theme = resolveCustomerTheme(customerThemeKey);
  const themeStyles = themeToCssVariables(theme);

  return (
    <div
      id="qf-customer-theme-root"
      data-theme={theme.key}
      style={themeStyles}
      className="contents"
    >
      {children}
    </div>
  );
}

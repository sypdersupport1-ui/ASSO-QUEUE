import React from 'react';

/**
 * Platform Identity Level 1: Official ASSO Customer-Facing Brand Logo
 *
 * Requirements:
 * - Position: Top-left aligned (justify-start), outside glass cards
 * - Alignment: Shares canonical 16–20px left content inset with customer shell
 * - Asset: Canonical static asset /brand/asso/asso-customer-white.png
 * - Black Background: Preserved on compact logo bounds (bg-black rounded-md)
 * - Complete Lockup: Preserves ASSO wordmark, geometric A, gradient ring, and "BUSINESS MANAGEMENT & Q"
 * - Compact Height: ~24px mobile (h-6), ~28px desktop (sm:h-7)
 * - Accessibility: alt="ASSO — Business Management & Q", not aria-hidden
 * - Reusable across all customer themes without dynamic recoloring
 */
export function CustomerPlatformBrand() {
  return (
    <div className="flex items-center justify-start pt-1 pb-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/asso/asso-customer-white.png"
        alt="ASSO — Business Management & Q"
        width={1024}
        height={341}
        className="h-6 sm:h-7 w-auto object-contain bg-black rounded-md select-none"
        decoding="async"
      />
    </div>
  );
}

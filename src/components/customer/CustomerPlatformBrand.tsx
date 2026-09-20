import React from 'react';

/**
 * Platform Identity Level 1: Official ASSO Customer-Facing Brand Logo
 *
 * Requirements:
 * - Position: Top-left aligned (justify-start), outside glass cards
 * - Alignment: Shares canonical 16–20px left content inset with customer shell
 * - Asset: Canonical transparent asset /brand/asso/asso-customer-white.png
 * - Transparent Presentation: Floats naturally over theme atmosphere (NO black box / rectangle)
 * - Complete Lockup: Preserves ASSO wordmark, geometric A, gradient ring, and "BUSINESS MANAGEMENT & Q"
 * - Prominent Size: ~36px mobile (h-9), ~40px desktop (sm:h-10) for clear readability of descriptor text
 * - Accessibility: alt="ASSO — Business Management & Q", not aria-hidden
 * - Reusable across all customer themes without dynamic recoloring
 */
export function CustomerPlatformBrand() {
  return (
    <div className="flex items-center justify-start pt-1.5 pb-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/asso/asso-customer-white.png"
        alt="ASSO — Business Management & Q"
        width={1024}
        height={341}
        className="h-10 sm:h-11 w-auto object-contain select-none"
        decoding="async"
      />
    </div>
  );
}

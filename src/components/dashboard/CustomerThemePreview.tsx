'use client';

import React from 'react';
import type { CustomerTheme } from '@/lib/themes/types';
import { themeToCssVariables } from '@/lib/themes/resolver';
import { ThemeArtwork } from '@/components/themes';

export interface CustomerThemePreviewProps {
  theme: CustomerTheme;
  variant?: 'card' | 'modal';
  restaurantName?: string;
}

/**
 * Reusable visual preview component for Customer Themes.
 *
 * Core Invariant:
 * 100% token-driven via themeToCssVariables(theme).
 * Zero hardcoded color overrides — uses semantic var(--qf-*) custom properties.
 * Pure presentation mockup — completely inert with zero side effects on queue or orders.
 */
export function CustomerThemePreview({
  theme,
  variant = 'card',
  restaurantName = 'Spice Route Grand',
}: CustomerThemePreviewProps) {
  const cssVariables = themeToCssVariables(theme);
  const isModal = variant === 'modal';

  if (isModal) {
    return (
      <div
        className="w-full max-w-[340px] sm:max-w-[380px] mx-auto rounded-[2.5rem] border-4 border-slate-700/80 bg-slate-950 p-3 shadow-2xl relative overflow-hidden"
        style={cssVariables as React.CSSProperties}
      >
        {/* Simulated Phone Speaker / Notch */}
        <div className="w-24 h-4 bg-slate-800 rounded-full mx-auto mb-2 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-slate-900 border border-slate-700 mr-2" />
          <div className="w-8 h-1 bg-slate-700 rounded-full" />
        </div>

        {/* Customer Experience Body simulating /q/[slug] */}
        <div
          className="rounded-[2rem] p-4 text-left relative overflow-hidden flex flex-col gap-3 min-h-[500px]"
          style={{
            backgroundColor: 'var(--qf-background)',
            color: 'var(--qf-text)',
            borderColor: 'var(--qf-border)',
          }}
        >
          {/* Thematic Artwork & Ambient Motif */}
          <ThemeArtwork theme={theme} variant="modal" />

          {/* Restaurant Header */}
          <div className="relative z-10 flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--qf-border-subtle)' }}>
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shadow-md"
                style={{
                  backgroundColor: 'var(--qf-primary)',
                  color: 'var(--qf-primary-foreground)',
                }}
              >
                {restaurantName.charAt(0)}
              </div>
              <div>
                <h4 className="font-bold text-sm tracking-tight leading-tight line-clamp-1" style={{ color: 'var(--qf-text)' }}>
                  {restaurantName}
                </h4>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--qf-status-success)' }} />
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--qf-text-muted)' }}>Queue Active • Fast Moving</span>
                </div>
              </div>
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border"
              style={{
                backgroundColor: 'var(--qf-surface)',
                borderColor: 'var(--qf-border)',
                color: 'var(--qf-primary)',
              }}
            >
              Live
            </span>
          </div>

          {/* Live Queue Pulse Banner */}
          <div
            className="relative z-10 p-3 rounded-2xl border flex items-center justify-between"
            style={{
              backgroundColor: 'var(--qf-surface)',
              borderColor: 'var(--qf-border)',
            }}
          >
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'var(--qf-text-muted)' }}>Current Wait</span>
              <div className="text-lg font-black tracking-tight" style={{ color: 'var(--qf-primary)' }}>~12 Mins</div>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'var(--qf-text-muted)' }}>Waiting Parties</span>
              <div className="text-base font-bold" style={{ color: 'var(--qf-text)' }}>4 Ahead</div>
            </div>
          </div>

          {/* Service Selector Mock (Dine-In vs Takeaway) */}
          <div className="relative z-10 flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--qf-text-secondary)' }}>
              Choose Service
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div
                className="p-3 rounded-xl border flex flex-col items-center justify-center gap-1 text-center shadow-sm"
                style={{
                  backgroundColor: 'var(--qf-surface-elevated)',
                  borderColor: 'var(--qf-accent-dine-in)',
                }}
              >
                <span className="text-sm">🍽️</span>
                <span className="text-xs font-bold" style={{ color: 'var(--qf-accent-dine-in)' }}>Dine-In</span>
                <span className="text-[9px]" style={{ color: 'var(--qf-text-muted)' }}>Table Seating</span>
              </div>
              <div
                className="p-3 rounded-xl border flex flex-col items-center justify-center gap-1 text-center opacity-80"
                style={{
                  backgroundColor: 'var(--qf-surface)',
                  borderColor: 'var(--qf-border)',
                }}
              >
                <span className="text-sm">🛍️</span>
                <span className="text-xs font-bold" style={{ color: 'var(--qf-accent-takeaway)' }}>Takeaway</span>
                <span className="text-[9px]" style={{ color: 'var(--qf-text-muted)' }}>Express Counter</span>
              </div>
            </div>
          </div>

          {/* Party Size Simulated Selector */}
          <div
            className="relative z-10 p-3 rounded-2xl border flex flex-col gap-2"
            style={{
              backgroundColor: 'var(--qf-surface)',
              borderColor: 'var(--qf-border)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold" style={{ color: 'var(--qf-text-secondary)' }}>Party Size</span>
              <span className="text-xs font-bold" style={{ color: 'var(--qf-primary)' }}>2 Guests</span>
            </div>
            <div className="flex gap-1.5 justify-between">
              {[1, 2, 3, 4, 5].map((num) => (
                <div
                  key={num}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border transition-colors"
                  style={{
                    backgroundColor: num === 2 ? 'var(--qf-primary)' : 'var(--qf-surface-solid)',
                    color: num === 2 ? 'var(--qf-primary-foreground)' : 'var(--qf-text)',
                    borderColor: num === 2 ? 'var(--qf-primary)' : 'var(--qf-border)',
                  }}
                >
                  {num}
                </div>
              ))}
            </div>
          </div>

          {/* Primary CTA Mock */}
          <div className="relative z-10 mt-auto pt-2">
            <div
              className="w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg tracking-wide uppercase"
              style={{
                backgroundColor: 'var(--qf-primary)',
                color: 'var(--qf-primary-foreground)',
              }}
            >
              <span>Join Queue Now</span>
              <span>→</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: Card Variant (Miniature composition for library grid)
  return (
    <div
      className="w-full aspect-[16/10] rounded-2xl p-3.5 relative overflow-hidden border flex flex-col justify-between select-none"
      style={{
        ...cssVariables as React.CSSProperties,
        backgroundColor: 'var(--qf-background)',
        color: 'var(--qf-text)',
        borderColor: 'var(--qf-border)',
      }}
    >
      {/* Thematic Artwork & Ambient Motif */}
      <ThemeArtwork theme={theme} variant="card" />

      {/* Mini Header */}
      <div className="relative z-10 flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--qf-border-subtle)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[11px] shadow-sm shrink-0"
            style={{
              backgroundColor: 'var(--qf-primary)',
              color: 'var(--qf-primary-foreground)',
            }}
          >
            {restaurantName.charAt(0)}
          </div>
          <span className="font-bold text-xs truncate" style={{ color: 'var(--qf-text)' }}>
            {restaurantName}
          </span>
        </div>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: 'var(--qf-status-success)' }}
          title="Online"
        />
      </div>

      {/* Mini Composition Body */}
      <div className="relative z-10 flex flex-col gap-2 py-1">
        {/* Service Options simulation */}
        <div className="grid grid-cols-2 gap-1.5">
          <div
            className="px-2 py-1.5 rounded-lg border text-[10px] font-bold flex items-center justify-center gap-1"
            style={{
              backgroundColor: 'var(--qf-surface-elevated)',
              borderColor: 'var(--qf-accent-dine-in)',
              color: 'var(--qf-accent-dine-in)',
            }}
          >
            <span>🍽️</span>
            <span>Dine-In</span>
          </div>
          <div
            className="px-2 py-1.5 rounded-lg border text-[10px] font-medium flex items-center justify-center gap-1 opacity-75"
            style={{
              backgroundColor: 'var(--qf-surface)',
              borderColor: 'var(--qf-border)',
              color: 'var(--qf-accent-takeaway)',
            }}
          >
            <span>🛍️</span>
            <span>Takeaway</span>
          </div>
        </div>

        {/* Mini Ticket / Status card */}
        <div
          className="p-2 rounded-xl border flex items-center justify-between"
          style={{
            backgroundColor: 'var(--qf-surface)',
            borderColor: 'var(--qf-border-subtle)',
          }}
        >
          <div className="flex flex-col">
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: 'var(--qf-text-muted)' }}>Ticket</span>
            <span className="text-xs font-black font-mono" style={{ color: 'var(--qf-text)' }}>#A-042</span>
          </div>
          <div
            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{
              backgroundColor: 'var(--qf-primary)',
              color: 'var(--qf-primary-foreground)',
            }}
          >
            ~10m
          </div>
        </div>
      </div>

      {/* Mini CTA button */}
      <div
        className="relative z-10 w-full py-1.5 rounded-lg font-bold text-[10px] text-center uppercase tracking-wider shadow-sm"
        style={{
          backgroundColor: 'var(--qf-primary)',
          color: 'var(--qf-primary-foreground)',
        }}
      >
        QueueFlow Preview
      </div>
    </div>
  );
}

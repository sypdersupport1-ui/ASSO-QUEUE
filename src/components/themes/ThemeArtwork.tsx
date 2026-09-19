import React from 'react';
import type { CustomerTheme, ThemeMotifKind } from '@/lib/themes/types';
import { resolveCustomerTheme } from '@/lib/themes/resolver';

export interface ThemeArtworkProps {
  theme?: CustomerTheme | null;
  themeKey?: string | null;
  variant?: 'page' | 'card' | 'modal';
  className?: string;
}

/**
 * Canonical QueueFlow Theme Artwork & Decorative Motif Component.
 *
 * Provides subtle, hospitality-grade SVG motifs and ambient lighting
 * tailored to each of the 11 registered customer themes.
 *
 * Core Principles:
 * 1. 100% presentation-only: aria-hidden="true", pointer-events-none, z-0.
 * 2. Hospitality aesthetic: Restrained opacity (8%–14%), elegant vector lines, zero clutter.
 * 3. Zero network dependencies: Pure local inline SVG & CSS gradients.
 * 4. Responsive & adaptable: Gracefully scales across page backgrounds, card previews, and phone modals.
 */
export function ThemeArtwork({
  theme,
  themeKey,
  variant = 'page',
  className = '',
}: ThemeArtworkProps) {
  const activeTheme = theme ?? resolveCustomerTheme(themeKey);
  const artwork = activeTheme.artwork ?? { motif: 'none' as ThemeMotifKind, opacity: 0.08 };
  const motif = artwork.motif || 'none';

  // Opacity scaling based on variant: cards slightly more visible so small details read clearly
  const baseOpacity = artwork.opacity ?? 0.11;
  const effectiveOpacity = variant === 'card' ? Math.min(0.28, baseOpacity * 1.4) : baseOpacity;

  const isCard = variant === 'card';

  return (
    <div
      aria-hidden="true"
      data-theme-motif={motif}
      data-variant={variant}
      style={{ opacity: effectiveOpacity }}
      className={`pointer-events-none absolute inset-0 overflow-hidden select-none transition-opacity duration-300 ${className}`}
    >
      {/* 1. DEFAULT (QueueFlow Premium) - Neutral minimal hospitality glow */}
      {motif === 'none' && (
        <div className="absolute inset-0">
          <div
            className={`absolute rounded-full blur-3xl ${
              isCard
                ? '-top-8 -right-8 w-24 h-24 opacity-60'
                : 'top-0 right-1/4 w-72 h-72 opacity-40'
            }`}
            style={{ background: 'var(--qf-primary-glow)' }}
          />
        </div>
      )}

      {/* 2. DURGA PUJA - Bengali Alpana & Lotus Geometry */}
      {motif === 'alpana' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Concentric Alpana Rings */}
            <circle cx="280" cy="120" r="140" strokeDasharray="3 4" opacity="0.6" />
            <circle cx="280" cy="120" r="110" strokeWidth="1" />
            <circle cx="280" cy="120" r="80" strokeDasharray="2 3" opacity="0.7" />
            <circle cx="280" cy="120" r="50" strokeWidth="1.5" />
            <circle cx="280" cy="120" r="20" fill="var(--qf-primary)" fillOpacity="0.15" />

            {/* Symmetrical Bengali Lotus Petal Curves */}
            <path d="M280 40 C300 70 330 90 360 120 C330 150 300 170 280 200 C260 170 230 150 200 120 C230 90 260 70 280 40 Z" />
            <path d="M200 120 C230 140 250 170 280 200 C310 170 330 140 360 120" strokeDasharray="4 4" />
            <path d="M280 60 C295 85 315 105 340 120 C315 135 295 155 280 180 C265 155 245 135 220 120 C245 105 265 85 280 60 Z" opacity="0.8" />

            {/* Ceremonial Alpana Floral Dots */}
            <circle cx="280" cy="65" r="3" fill="var(--qf-accent-takeaway)" />
            <circle cx="335" cy="120" r="3" fill="var(--qf-accent-takeaway)" />
            <circle cx="280" cy="175" r="3" fill="var(--qf-accent-takeaway)" />
            <circle cx="225" cy="120" r="3" fill="var(--qf-accent-takeaway)" />
            <circle cx="318" cy="82" r="2.5" fill="var(--qf-primary)" />
            <circle cx="318" cy="158" r="2.5" fill="var(--qf-primary)" />
            <circle cx="242" cy="158" r="2.5" fill="var(--qf-primary)" />
            <circle cx="242" cy="82" r="2.5" fill="var(--qf-primary)" />
          </g>
        </svg>
      )}

      {/* 3. KALI PUJA - Midnight Lotus & Diya Flame Glow points */}
      {motif === 'midnight-lotus' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round">
            {/* Arched Midnight Celestial Canopy */}
            <path d="M120 40 Q250 80 360 200" strokeDasharray="3 5" opacity="0.6" />
            <path d="M160 30 Q270 90 380 230" strokeWidth="0.8" opacity="0.4" />

            {/* Sacred Lotus Blossom Line-Art */}
            <path d="M280 140 C280 95 305 75 320 60 C335 75 360 95 360 140 C340 145 320 140 280 140 Z" fill="var(--qf-primary)" fillOpacity="0.08" />
            <path d="M280 140 C255 105 240 75 220 70 C240 95 260 120 280 140 Z" />
            <path d="M360 140 C385 105 400 75 420 70 C400 95 380 120 360 140 Z" />

            {/* Diya Flame Beacon Accent */}
            <path d="M320 58 C315 45 320 30 320 20 C325 30 330 45 320 58 Z" fill="var(--qf-accent-takeaway)" stroke="var(--qf-accent-takeaway)" strokeWidth="1" />
            <circle cx="320" cy="38" r="8" fill="var(--qf-accent-takeaway)" fillOpacity="0.25" />

            {/* Radiating Midnight Flame Stars */}
            <circle cx="250" cy="90" r="1.5" fill="var(--qf-text)" />
            <circle cx="380" cy="110" r="2" fill="var(--qf-accent-takeaway)" />
            <circle cx="290" cy="180" r="1.5" fill="var(--qf-text)" />
          </g>
        </svg>
      )}

      {/* 4. DIWALI - Luminous Rangoli & Diya Silhouettes */}
      {motif === 'diwali-rangoli' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-12 -right-12 w-80 h-80 sm:w-96 sm:h-96'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Luminous Rangoli Star Mandala */}
            <circle cx="280" cy="120" r="120" strokeDasharray="2 4" opacity="0.5" />
            <polygon points="280,30 305,95 370,120 305,145 280,210 255,145 190,120 255,95" strokeWidth="1.2" opacity="0.85" />
            <polygon points="280,55 298,102 345,120 298,138 280,185 262,138 215,120 262,102" strokeDasharray="3 3" opacity="0.6" />
            <circle cx="280" cy="120" r="30" strokeWidth="1" fill="var(--qf-primary)" fillOpacity="0.1" />

            {/* Traditional Diya Silhouette */}
            <g transform="translate(190, 40)">
              {/* Diya Base */}
              <path d="M10 25 Q30 42 50 25 Q30 30 10 25 Z" fill="var(--qf-accent-takeaway)" stroke="var(--qf-accent-takeaway)" strokeWidth="1.2" />
              {/* Diya Flame */}
              <path d="M30 24 C26 16 30 6 30 0 C34 6 38 16 30 24 Z" fill="var(--qf-primary)" stroke="var(--qf-accent-takeaway)" strokeWidth="1" />
              <circle cx="30" cy="10" r="6" fill="var(--qf-primary)" fillOpacity="0.3" />
            </g>

            {/* Luminous Sparkle Star Points */}
            <path d="M350 45 L350 55 M345 50 L355 50" stroke="var(--qf-accent-takeaway)" strokeWidth="1.5" />
            <path d="M220 170 L220 178 M216 174 L224 174" stroke="var(--qf-primary)" strokeWidth="1.2" />
            <path d="M330 190 L330 196 M327 193 L333 193" stroke="var(--qf-text)" strokeWidth="1" />
          </g>
        </svg>
      )}

      {/* 5. HOLI - Soft Organic Translucent Powder Clouds */}
      {motif === 'holi-powder' && (
        <div className="absolute inset-0">
          {/* Layered soft-blur celebratory color clouds */}
          <div
            className={`absolute rounded-full blur-2xl ${
              isCard
                ? '-top-6 -right-6 w-32 h-32 opacity-75'
                : '-top-12 -right-8 w-64 h-64 opacity-60'
            }`}
            style={{
              background: 'radial-gradient(circle, var(--qf-primary) 0%, transparent 70%)',
            }}
          />
          <div
            className={`absolute rounded-full blur-3xl ${
              isCard
                ? 'top-4 right-12 w-24 h-24 opacity-65'
                : 'top-8 right-24 w-52 h-52 opacity-50'
            }`}
            style={{
              background: 'radial-gradient(circle, var(--qf-accent-takeaway) 0%, transparent 65%)',
            }}
          />
          <svg
            viewBox="0 0 300 300"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`absolute ${
              isCard
                ? 'top-0 right-0 w-32 h-32'
                : '-top-4 right-0 w-64 h-64'
            }`}
          >
            <g stroke="var(--qf-primary)" strokeWidth="1.2" opacity="0.6">
              {/* Playful celebratory rings */}
              <circle cx="210" cy="90" r="50" strokeDasharray="3 5" />
              <circle cx="210" cy="90" r="75" strokeDasharray="4 6" opacity="0.4" />
              <circle cx="160" cy="60" r="8" fill="var(--qf-primary)" fillOpacity="0.3" />
              <circle cx="240" cy="140" r="6" fill="var(--qf-accent-takeaway)" fillOpacity="0.4" />
              <circle cx="260" cy="70" r="4" fill="var(--qf-accent-dine-in)" fillOpacity="0.4" />
              <circle cx="170" cy="120" r="3" fill="var(--qf-text)" />
            </g>
          </svg>
        </div>
      )}

      {/* 6. CHRISTMAS - Evergreen Pine Silhouettes & Festive Stars */}
      {motif === 'evergreen-festive' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round">
            {/* Elegant Pine Branch Spine */}
            <path d="M380 40 Q280 100 200 220" strokeWidth="1.5" />
            <path d="M340 30 Q260 80 180 180" strokeDasharray="3 4" opacity="0.5" />

            {/* Pine Needle Clusters */}
            <path d="M340 70 L365 55 M340 70 L370 70 M340 70 L360 85" strokeWidth="1.2" />
            <path d="M305 100 L330 85 M305 100 L335 100 M305 100 L325 115" strokeWidth="1.2" />
            <path d="M270 135 L295 120 M270 135 L300 135 M270 135 L290 150" strokeWidth="1.2" />
            <path d="M235 175 L260 160 M235 175 L265 175 M235 175 L255 190" strokeWidth="1.2" />

            {/* Delicate Starlight Ornaments */}
            <path d="M220 70 L220 86 M212 78 L228 78" stroke="var(--qf-accent-takeaway)" strokeWidth="1.4" />
            <circle cx="220" cy="78" r="1.5" fill="var(--qf-text)" />

            <path d="M310 160 L310 172 M304 166 L316 166" stroke="var(--qf-accent-dine-in)" strokeWidth="1.2" />
            <circle cx="310" cy="166" r="1.5" fill="var(--qf-text)" />

            {/* Soft Snow Dust Textures */}
            <circle cx="250" cy="50" r="1.5" fill="var(--qf-text)" opacity="0.8" />
            <circle cx="280" cy="40" r="1" fill="var(--qf-text)" opacity="0.6" />
            <circle cx="190" cy="130" r="1.5" fill="var(--qf-text)" opacity="0.7" />
            <circle cx="210" cy="150" r="1" fill="var(--qf-text)" opacity="0.5" />
          </g>
        </svg>
      )}

      {/* 7. VALENTINE'S DAY - Refined Botanical Petals & Geometric Heart Curves */}
      {motif === 'romantic-botanical' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Subtle interlocking curved heart geometry */}
            <path
              d="M300 90 C300 65 320 50 340 50 C360 50 375 70 375 90 C375 125 330 160 300 180 C270 160 225 125 225 90 C225 70 240 50 260 50 C280 50 300 65 300 90 Z"
              fill="var(--qf-primary)"
              fillOpacity="0.08"
            />
            <path
              d="M300 105 C300 85 315 72 330 72 C345 72 358 88 358 105 C358 132 322 160 300 172 C278 160 242 132 242 105 C242 88 255 72 270 72 C285 72 300 85 300 105 Z"
              strokeDasharray="3 3"
              opacity="0.6"
            />

            {/* Fine Botanical Rose Petal Swirls */}
            <path d="M190 60 Q240 100 270 160" strokeWidth="0.8" opacity="0.5" />
            <path d="M350 140 Q370 180 340 230" strokeWidth="0.8" opacity="0.4" />

            {/* Champagne Shimmer Dots */}
            <circle cx="210" cy="80" r="1.5" fill="var(--qf-accent-takeaway)" />
            <circle cx="365" cy="100" r="2" fill="var(--qf-accent-takeaway)" />
            <circle cx="310" cy="200" r="1.5" fill="var(--qf-text)" />
          </g>
        </svg>
      )}

      {/* 8. POILA BOISHAKH - Authentic Bengali Kalka & Alpana Medallion */}
      {motif === 'boishakh-heritage' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Traditional Bengali Kalka (Paisley) Contour */}
            <path
              d="M320 60 C360 100 370 170 320 220 C270 270 200 240 190 190 C180 140 220 110 260 110 C290 110 310 130 300 150 C290 170 265 170 255 155"
              fill="var(--qf-primary)"
              fillOpacity="0.08"
            />
            {/* Inner Alpana Filigree */}
            <path d="M260 130 C275 140 280 160 270 175 C250 190 220 180 215 155" strokeDasharray="2 3" opacity="0.7" />
            <circle cx="250" cy="155" r="4" fill="var(--qf-accent-takeaway)" />

            {/* Ceremonial Rice-Paste Alpana Border Dots */}
            <circle cx="335" cy="85" r="2.5" fill="var(--qf-text)" />
            <circle cx="355" cy="125" r="2.5" fill="var(--qf-text)" />
            <circle cx="350" cy="170" r="2.5" fill="var(--qf-text)" />
            <circle cx="315" cy="210" r="2.5" fill="var(--qf-text)" />
            <circle cx="270" cy="235" r="2.5" fill="var(--qf-text)" />
            <circle cx="220" cy="225" r="2.5" fill="var(--qf-text)" />

            {/* Radiating Ceremonial Rays */}
            <line x1="320" y1="60" x2="345" y2="40" stroke="var(--qf-accent-takeaway)" strokeWidth="1.5" />
            <line x1="340" y1="75" x2="365" y2="60" stroke="var(--qf-primary)" />
            <line x1="360" y1="95" x2="385" y2="85" stroke="var(--qf-primary)" />
          </g>
        </svg>
      )}

      {/* 9. HAPPY NEW YEAR - Modern Celebration Rays & Confetti Sparkles */}
      {motif === 'celebration-spark' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round">
            {/* Elegant Celebratory Radial Rays */}
            <line x1="320" y1="80" x2="240" y2="160" strokeWidth="1.5" />
            <line x1="320" y1="80" x2="200" y2="120" strokeDasharray="3 4" opacity="0.6" />
            <line x1="320" y1="80" x2="280" y2="200" strokeDasharray="3 4" opacity="0.6" />
            <line x1="320" y1="80" x2="160" y2="70" opacity="0.5" />
            <line x1="320" y1="80" x2="330" y2="220" opacity="0.4" />

            {/* Radiant Center Burst */}
            <circle cx="320" cy="80" r="16" fill="var(--qf-primary)" fillOpacity="0.15" stroke="var(--qf-primary)" strokeWidth="1" />
            <circle cx="320" cy="80" r="6" fill="var(--qf-accent-takeaway)" />

            {/* Modern Confetti Geometry (diamonds & circles) */}
            <polygon points="250,110 256,116 250,122 244,116" fill="var(--qf-accent-takeaway)" stroke="none" />
            <polygon points="270,180 275,185 270,190 265,185" fill="var(--qf-primary)" stroke="none" />
            <polygon points="190,100 194,104 190,108 186,104" fill="var(--qf-text)" stroke="none" />

            <circle cx="220" cy="150" r="2" fill="var(--qf-accent-takeaway)" />
            <circle cx="290" cy="150" r="2.5" fill="var(--qf-primary)" />
            <circle cx="170" cy="130" r="1.5" fill="var(--qf-text)" />
          </g>
        </svg>
      )}

      {/* 10. HAPPY HOUR - Refined Cocktail Coupe Line Art & Copper Lounge Glow */}
      {motif === 'cocktail-lounge' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Elegant Cocktail Coupe Silhouette */}
            {/* Bowl */}
            <path d="M260 90 C260 125 340 125 340 90 Z" fill="var(--qf-primary)" fillOpacity="0.12" strokeWidth="1.4" />
            {/* Rim */}
            <line x1="250" y1="90" x2="350" y2="90" strokeWidth="1.5" />
            {/* Stem */}
            <line x1="300" y1="125" x2="300" y2="185" strokeWidth="1.5" />
            {/* Base */}
            <path d="M280 185 Q300 183 320 185" strokeWidth="2" />

            {/* Botanical Rosemary / Citrus Garnish Line Art */}
            <path d="M300 65 Q310 80 325 90" stroke="var(--qf-accent-takeaway)" strokeWidth="1.2" />
            <circle cx="295" cy="65" r="3" fill="var(--qf-accent-takeaway)" />
            <circle cx="328" cy="92" r="2.5" fill="var(--qf-accent-takeaway)" />

            {/* Ambient Copper Bar Arcs */}
            <circle cx="300" cy="110" r="90" strokeDasharray="3 5" opacity="0.4" />
            <circle cx="300" cy="110" r="130" strokeDasharray="2 4" opacity="0.25" />
          </g>
        </svg>
      )}

      {/* 11. WEEKEND SPECIAL - Relaxed Botanical Brunch Leaf Vectors */}
      {motif === 'botanical-brunch' && (
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`absolute ${
            isCard
              ? '-top-6 -right-6 w-36 h-36'
              : '-top-10 -right-10 w-72 h-72 sm:w-88 sm:h-88'
          }`}
        >
          <g stroke="var(--qf-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Graceful Olive / Monstera Botanical Frond Spine */}
            <path d="M360 30 Q280 110 200 230" strokeWidth="1.5" />

            {/* Paired Organic Botanical Leaves */}
            {/* Leaf Pair 1 */}
            <path d="M330 65 C350 60 370 75 365 95 C345 90 330 80 330 65 Z" fill="var(--qf-primary)" fillOpacity="0.1" />
            <path d="M315 80 C295 70 280 85 285 105 C305 105 315 95 315 80 Z" fill="var(--qf-primary)" fillOpacity="0.08" />

            {/* Leaf Pair 2 */}
            <path d="M285 115 C305 110 325 125 320 145 C300 140 285 130 285 115 Z" fill="var(--qf-primary)" fillOpacity="0.1" />
            <path d="M265 135 C245 125 230 140 235 160 C255 160 265 150 265 135 Z" fill="var(--qf-primary)" fillOpacity="0.08" />

            {/* Leaf Pair 3 */}
            <path d="M240 170 C260 165 275 180 270 200 C250 195 240 185 240 170 Z" fill="var(--qf-primary)" fillOpacity="0.1" />

            {/* Warm Sunlight Brunch Arcs */}
            <circle cx="320" cy="80" r="80" strokeDasharray="3 5" opacity="0.4" />
            <circle cx="210" cy="90" r="2" fill="var(--qf-accent-takeaway)" />
            <circle cx="340" cy="180" r="2" fill="var(--qf-accent-takeaway)" />
          </g>
        </svg>
      )}
    </div>
  );
}

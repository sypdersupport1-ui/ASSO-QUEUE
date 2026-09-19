'use client';

import React, { useEffect } from 'react';
import type { CustomerTheme } from '@/lib/themes/types';
import { CustomerThemePreview } from './CustomerThemePreview';

export interface CustomerThemePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: CustomerTheme | null;
  restaurantName?: string;
  isActiveTheme?: boolean;
  onSelectTheme?: (themeKey: string) => void;
  isSaving?: boolean;
  hideSelectButton?: boolean;
}

/**
 * Full Customer Theme Preview Modal / Drawer.
 *
 * Responsively renders a true-to-life customer mobile experience for the selected theme.
 * Crucial Invariants:
 * - Pure preview: NEVER mutates database on modal open or view.
 * - Only clicking "Use This Theme" invokes theme selection.
 * - Fully accessible with keyboard navigation (Escape to dismiss).
 */
export function CustomerThemePreviewModal({
  isOpen,
  onClose,
  theme,
  restaurantName = 'Spice Route Grand',
  isActiveTheme = false,
  onSelectTheme,
  isSaving = false,
  hideSelectButton = false,
}: CustomerThemePreviewModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !theme) return null;

  const categoryLabel = theme.metadata?.category
    ? theme.metadata.category.toUpperCase()
    : 'EXPERIENCE';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-preview-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-[#0E1524] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3 bg-[#131B2E]">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-md shrink-0 border border-white/10"
              style={{
                backgroundColor: theme.tokens.accents.primary,
                color: theme.tokens.accents.primaryForeground,
              }}
            >
              {theme.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="theme-preview-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {theme.name}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/10 text-slate-300 border border-white/10">
                  {categoryLabel}
                </span>
                {theme.artwork?.motif && theme.artwork.motif !== 'none' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-primary/20 text-blue-300 border border-primary/30 capitalize">
                    {theme.artwork.motif.replace(/-/g, ' ')} Motif
                  </span>
                )}
                {isActiveTheme && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <span>✓</span>
                    <span>Currently Active</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                {theme.description || 'Curated QueueFlow customer theme.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            disabled={isSaving}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body: Scrollable Customer Preview Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#090D16] flex flex-col items-center justify-center min-h-0">
          <div className="text-center mb-3">
            <span className="text-[11px] font-medium text-slate-400">
              Live QR Preview — what your guests see on mobile
            </span>
          </div>

          {/* Render Full Simulated Customer Phone Frame */}
          <CustomerThemePreview
            theme={theme}
            variant="modal"
            restaurantName={restaurantName}
          />
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-[#131B2E] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
          >
            Close Preview
          </button>

          {!hideSelectButton && onSelectTheme && (
            isActiveTheme ? (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                <span>✓ Active Theme on QR</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelectTheme(theme.key)}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-blue-500 active:bg-blue-600 text-white text-xs font-bold shadow-[0_0_15px_rgba(37,99,235,0.35)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Applying Theme...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">palette</span>
                    <span>Use This Theme</span>
                  </>
                )}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

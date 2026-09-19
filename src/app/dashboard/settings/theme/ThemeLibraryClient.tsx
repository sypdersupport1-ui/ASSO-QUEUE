'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { CustomerTheme } from '@/lib/themes/types';
import { CustomerThemePreview } from '@/components/dashboard/CustomerThemePreview';
import { CustomerThemePreviewModal } from '@/components/dashboard/CustomerThemePreviewModal';
import { updateCustomerThemeAction } from '@/app/dashboard/actions';

import { resolveCustomerTheme } from '@/lib/themes/resolver';

export interface ThemeLibraryClientProps {
  restaurantName: string;
  initialThemeKey: string;
  themes: CustomerTheme[];
}

type ThemeCategoryFilter = 'ALL' | 'core' | 'cultural' | 'seasonal' | 'modern';

export default function ThemeLibraryClient({
  restaurantName,
  initialThemeKey,
  themes,
}: ThemeLibraryClientProps) {
  const [activeThemeKey, setActiveThemeKey] = useState<string>(initialThemeKey || 'default');
  const [previewTheme, setPreviewTheme] = useState<CustomerTheme | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ThemeCategoryFilter>('ALL');
  const [isSaving, setIsSaving] = useState(false);
  const [savingThemeKey, setSavingThemeKey] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-dismiss success toast after 5 seconds
  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(null), 5000);
    return () => clearTimeout(timer);
  }, [successToast]);

  const activeTheme: CustomerTheme = themes.find((t) => t.key === activeThemeKey) ?? resolveCustomerTheme(activeThemeKey);

  // Category filtering
  const filteredThemes = themes.filter((t) => {
    if (selectedCategory === 'ALL') return true;
    return t.metadata?.category === selectedCategory;
  });

  const categoryCounts = {
    ALL: themes.length,
    core: themes.filter((t) => t.metadata?.category === 'core').length,
    cultural: themes.filter((t) => t.metadata?.category === 'cultural').length,
    seasonal: themes.filter((t) => t.metadata?.category === 'seasonal').length,
    modern: themes.filter((t) => t.metadata?.category === 'modern').length,
  };

  const handleSelectTheme = async (themeKey: string) => {
    if (isSaving || themeKey === activeThemeKey) return;

    setIsSaving(true);
    setSavingThemeKey(themeKey);
    setErrorMsg(null);

    const targetTheme = themes.find((t) => t.key === themeKey);
    const targetName = targetTheme?.name || themeKey;

    try {
      const res = await updateCustomerThemeAction(themeKey);
      if (res.success && res.themeKey) {
        setActiveThemeKey(res.themeKey);
        setSuccessToast(`Customer theme updated to "${targetName}". Changes are now live on your customer QR!`);
        if (previewTheme) {
          setPreviewTheme(null);
        }
      } else {
        setErrorMsg(res.error || 'Failed to update theme.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error updating theme.');
    } finally {
      setIsSaving(false);
      setSavingThemeKey(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
            <Link href="/dashboard" className="hover:text-white transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <Link href="/dashboard/profile" className="hover:text-white transition-colors">
              Venue Settings
            </Link>
            <span>/</span>
            <span className="text-white font-medium">Customer Theme</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <span>Customer Experience &amp; Themes</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-primary/20 text-primary border border-primary/30">
              11 Approved Themes
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Choose the visual atmosphere customers experience when scanning your QueueFlow QR code. Themes adapt colors, glows, and celebratory accents while keeping queue integrity 100% stable.
          </p>
        </div>

        <Link
          href="/dashboard/settings/qr"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all shrink-0 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
          <span>View Customer QR</span>
        </Link>
      </div>

      {/* Success Notification Banner */}
      {successToast && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold flex items-center justify-between gap-3 animate-in fade-in duration-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-base">✓</span>
            <span>{successToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessToast(null)}
            className="w-6 h-6 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 flex items-center justify-center text-emerald-200 text-xs transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Alert Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs font-semibold flex items-center justify-between gap-3 animate-in fade-in duration-200 shadow-[0_0_20px_rgba(244,63,94,0.15)]"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-base">⚠️</span>
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="w-6 h-6 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 flex items-center justify-center text-rose-200 text-xs transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Current Theme Hero Showcase */}
      <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-[#101726] to-[#0A0E17] p-5 sm:p-7 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex flex-col gap-3 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Currently Active on QR</span>
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-400 border border-white/10">
                {activeTheme.metadata?.category || 'General'}
              </span>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {activeTheme.name}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                {activeTheme.description || 'Active presentation theme configured for all dine-in and takeaway customer QR scans.'}
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPreviewTheme(activeTheme)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                <span>Open Full QR Preview</span>
              </button>
              <div className="text-[11px] text-slate-400 font-mono">
                Key: <span className="text-slate-300 font-bold">{activeTheme.key}</span>
              </div>
            </div>
          </div>

          {/* Miniature Live Preview Box for Active Theme */}
          <div className="w-full lg:w-80 shrink-0">
            <CustomerThemePreview
              theme={activeTheme}
              variant="card"
              restaurantName={restaurantName}
            />
          </div>
        </div>
      </div>

      {/* Theme Library Section */}
      <div className="space-y-6">
        {/* Section Title & Filter Pills */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              Theme Library
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Select an occasion or festival theme to update your QR brand presentation instantly.
            </p>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-1">
            {(
              [
                { id: 'ALL', label: 'All Themes' },
                { id: 'core', label: 'Core' },
                { id: 'cultural', label: 'Cultural' },
                { id: 'seasonal', label: 'Seasonal' },
                { id: 'modern', label: 'Modern & Occasion' },
              ] as const
            ).map((cat) => {
              const count = categoryCounts[cat.id];
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-primary text-white border-primary shadow-[0_0_12px_rgba(37,99,235,0.3)]'
                      : 'bg-[#111827] text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Themes Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredThemes.map((theme) => {
            const isActive = theme.key === activeThemeKey;
            const isThemeSaving = isSaving && savingThemeKey === theme.key;

            return (
              <div
                key={theme.key}
                className={`rounded-3xl border bg-[#0E1524] p-4 flex flex-col justify-between gap-4 transition-all duration-200 group relative overflow-hidden ${
                  isActive
                    ? 'border-emerald-500/60 shadow-[0_0_25px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/40'
                    : 'border-white/10 hover:border-white/20 hover:shadow-xl'
                }`}
              >
                {/* Active Indicator Top Tag */}
                {isActive && (
                  <div className="absolute top-3 right-3 z-20">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950 font-sans shadow-md flex items-center gap-1">
                      <span>✓</span>
                      <span>Active</span>
                    </span>
                  </div>
                )}

                {/* Theme Visual Preview Card */}
                <div className="w-full relative rounded-2xl overflow-hidden shadow-inner">
                  <CustomerThemePreview
                    theme={theme}
                    variant="card"
                    restaurantName={restaurantName}
                  />
                </div>

                {/* Theme Information */}
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-base text-white tracking-tight group-hover:text-primary transition-colors">
                      {theme.name}
                    </h4>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-white/5 text-slate-400 border border-white/10 shrink-0">
                      {theme.metadata?.category || 'General'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {theme.description || 'Special occasion theme with customized visual language.'}
                  </p>
                </div>

                {/* Card Action Controls */}
                <div className="pt-2 border-t border-white/5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewTheme(theme)}
                    disabled={isSaving}
                    className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all text-center cursor-pointer"
                  >
                    Preview
                  </button>

                  {isActive ? (
                    <div className="flex-1 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold text-center flex items-center justify-center gap-1">
                      <span>✓ In Use</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSelectTheme(theme.key)}
                      disabled={isSaving}
                      className="flex-1 py-2 rounded-xl bg-primary hover:bg-blue-500 active:bg-blue-600 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 text-center cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isThemeSaving ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <span>Use Theme</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full Theme Preview Modal */}
      <CustomerThemePreviewModal
        isOpen={Boolean(previewTheme)}
        onClose={() => setPreviewTheme(null)}
        theme={previewTheme}
        restaurantName={restaurantName}
        isActiveTheme={previewTheme?.key === activeThemeKey}
        onSelectTheme={handleSelectTheme}
        isSaving={isSaving}
      />
    </div>
  );
}

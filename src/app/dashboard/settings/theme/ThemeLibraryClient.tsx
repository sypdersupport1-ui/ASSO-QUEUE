'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { CustomerTheme } from '@/lib/themes/types';
import { CustomerThemePreview } from '@/components/dashboard/CustomerThemePreview';
import { CustomerThemePreviewModal } from '@/components/dashboard/CustomerThemePreviewModal';
import {
  updateCustomerThemeAction,
  createCustomerThemeScheduleAction,
  updateCustomerThemeScheduleAction,
  cancelCustomerThemeScheduleAction,
} from '@/app/dashboard/actions';
import {
  resolveCustomerTheme,
  zonedDateTimeToUtc,
  utcToZonedDateTime,
  getTimezoneLabel,
  validateScheduleInterval,
  resolveEffectiveThemeFromSchedules,
  type CustomerThemeSchedule,
} from '@/lib/themes';

export interface ThemeLibraryClientProps {
  restaurantName: string;
  restaurantTimezone: string;
  initialThemeKey: string;
  initialSchedules?: CustomerThemeSchedule[];
  themes: CustomerTheme[];
}

type ThemeCategoryFilter = 'ALL' | 'core' | 'cultural' | 'seasonal' | 'modern';
type ScheduleFilterTab = 'ALL' | 'ACTIVE' | 'UPCOMING' | 'COMPLETED_OR_CANCELLED';

export default function ThemeLibraryClient({
  restaurantName,
  restaurantTimezone,
  initialThemeKey,
  initialSchedules = [],
  themes,
}: ThemeLibraryClientProps) {
  // Baseline theme state
  const [baseThemeKey, setBaseThemeKey] = useState<string>(initialThemeKey || 'default');
  const [schedules, setSchedules] = useState<CustomerThemeSchedule[]>(initialSchedules);

  // Preview modal state
  const [previewTheme, setPreviewTheme] = useState<CustomerTheme | null>(null);
  const [previewModalMode, setPreviewModalMode] = useState<'base' | 'preview_only'>('base');

  // Filter state for themes library
  const [selectedCategory, setSelectedCategory] = useState<ThemeCategoryFilter>('ALL');
  const [scheduleTab, setScheduleTab] = useState<ScheduleFilterTab>('ALL');

  // Loading & notification states
  const [isSavingBase, setIsSavingBase] = useState(false);
  const [savingBaseThemeKey, setSavingBaseThemeKey] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Schedule Modal form state
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<CustomerThemeSchedule | null>(null);
  const [formThemeKey, setFormThemeKey] = useState<string>('diwali');
  const [formStartDate, setFormStartDate] = useState<string>('');
  const [formStartTime, setFormStartTime] = useState<string>('00:00');
  const [formEndDate, setFormEndDate] = useState<string>('');
  const [formEndTime, setFormEndTime] = useState<string>('23:59');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  // Cancellation state
  const [cancellingScheduleId, setCancellingScheduleId] = useState<string | null>(null);

  // Auto-dismiss success toast after 5 seconds
  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(null), 5000);
    return () => clearTimeout(timer);
  }, [successToast]);

  // Current client time (refreshed periodically)
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Compute effective theme dynamically using canonical resolver
  const effectiveThemeResult = useMemo(() => {
    return resolveEffectiveThemeFromSchedules(
      baseThemeKey,
      schedules,
      now
    );
  }, [baseThemeKey, schedules, now]);

  const effectiveTheme = effectiveThemeResult.theme;
  const activeSchedule = effectiveThemeResult.activeSchedule;
  const isScheduleActive = effectiveThemeResult.isScheduled && Boolean(activeSchedule);

  const baseTheme = useMemo(() => {
    return themes.find((t) => t.key === baseThemeKey) ?? resolveCustomerTheme(baseThemeKey);
  }, [themes, baseThemeKey]);

  // Format restaurant timezone label
  const timezoneLabel = useMemo(() => {
    return getTimezoneLabel(restaurantTimezone || 'UTC');
  }, [restaurantTimezone]);

  // Filtered themes for library
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

  // Filtered schedules for schedules list
  const filteredSchedules = useMemo(() => {
    const nowMs = now.getTime();
    return schedules.filter((s) => {
      const startMs = new Date(s.start_at).getTime();
      const endMs = new Date(s.end_at).getTime();
      const isActive = s.status === 'ACTIVE' && startMs <= nowMs && nowMs < endMs;
      const isUpcoming = s.status === 'ACTIVE' && startMs > nowMs;
      const isCompletedOrCancelled = s.status === 'CANCELLED' || endMs <= nowMs;

      if (scheduleTab === 'ACTIVE') return isActive;
      if (scheduleTab === 'UPCOMING') return isUpcoming;
      if (scheduleTab === 'COMPLETED_OR_CANCELLED') return isCompletedOrCancelled;
      return true;
    });
  }, [schedules, scheduleTab, now]);

  // Handler: Select Base Theme
  const handleSelectBaseTheme = async (themeKey: string) => {
    if (isSavingBase || themeKey === baseThemeKey) return;

    setIsSavingBase(true);
    setSavingBaseThemeKey(themeKey);
    setErrorMsg(null);

    const targetTheme = themes.find((t) => t.key === themeKey);
    const targetName = targetTheme?.name || themeKey;

    try {
      const res = await updateCustomerThemeAction(themeKey);
      if (res.success && res.themeKey) {
        setBaseThemeKey(res.themeKey);
        setSuccessToast(
          isScheduleActive
            ? `Baseline theme updated to "${targetName}". Scheduled theme "${effectiveTheme.name}" is currently active on QR and will return to "${targetName}" when the schedule ends.`
            : `Baseline customer theme updated to "${targetName}". Live on customer QR now!`
        );
        if (previewTheme) {
          setPreviewTheme(null);
        }
      } else {
        setErrorMsg(res.error || 'Failed to update theme.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error updating theme.');
    } finally {
      setIsSavingBase(false);
      setSavingBaseThemeKey(null);
    }
  };

  // Open Schedule Modal (Create)
  const handleOpenCreateSchedule = (preselectedThemeKey?: string) => {
    setEditingSchedule(null);
    setFormThemeKey(preselectedThemeKey || 'diwali');

    // Default start date = tomorrow in restaurant timezone, end = 3 days later
    const tz = restaurantTimezone || 'UTC';
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const threeDays = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

    const startLocal = utcToZonedDateTime(tomorrow, tz);
    const endLocal = utcToZonedDateTime(threeDays, tz);

    setFormStartDate(startLocal.dateStr);
    setFormStartTime('00:00');
    setFormEndDate(endLocal.dateStr);
    setFormEndTime('23:59');
    setFormError(null);
    setIsScheduleModalOpen(true);
  };

  // Open Schedule Modal (Edit)
  const handleOpenEditSchedule = (schedule: CustomerThemeSchedule) => {
    setEditingSchedule(schedule);
    setFormThemeKey(schedule.theme_key);

    const tz = schedule.timezone || restaurantTimezone || 'UTC';
    const startLocal = utcToZonedDateTime(schedule.start_at, tz);
    const endLocal = utcToZonedDateTime(schedule.end_at, tz);

    setFormStartDate(startLocal.dateStr);
    setFormStartTime(startLocal.timeStr);
    setFormEndDate(endLocal.dateStr);
    setFormEndTime(endLocal.timeStr);
    setFormError(null);
    setIsScheduleModalOpen(true);
  };

  // Submit Schedule Modal (Create or Edit)
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formStartDate || !formStartTime || !formEndDate || !formEndTime) {
      setFormError('Please select both start date/time and end date/time.');
      return;
    }

    const tz = restaurantTimezone || 'UTC';

    let startAtUtc: Date;
    let endAtUtc: Date;

    try {
      startAtUtc = zonedDateTimeToUtc(formStartDate, formStartTime, tz);
      endAtUtc = zonedDateTimeToUtc(formEndDate, formEndTime, tz);
      validateScheduleInterval(startAtUtc, endAtUtc);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Invalid date/time interval.');
      return;
    }

    setIsSubmittingSchedule(true);

    try {
      if (editingSchedule) {
        const res = await updateCustomerThemeScheduleAction(editingSchedule.id, {
          themeKey: formThemeKey,
          startAt: startAtUtc.toISOString(),
          endAt: endAtUtc.toISOString(),
          timezone: tz,
        });

        if (res.success && res.schedule) {
          setSchedules((prev) =>
            prev.map((s) => (s.id === res.schedule!.id ? res.schedule! : s))
          );
          setIsScheduleModalOpen(false);
          setSuccessToast(`Schedule for "${themes.find((t) => t.key === formThemeKey)?.name || formThemeKey}" updated successfully!`);
        } else {
          setFormError(res.error || 'Failed to update schedule.');
        }
      } else {
        const res = await createCustomerThemeScheduleAction({
          themeKey: formThemeKey,
          startAt: startAtUtc.toISOString(),
          endAt: endAtUtc.toISOString(),
          timezone: tz,
        });

        if (res.success && res.schedule) {
          setSchedules((prev) => [...prev, res.schedule!].sort((a, b) => a.start_at.localeCompare(b.start_at)));
          setIsScheduleModalOpen(false);
          setSuccessToast(`Theme "${themes.find((t) => t.key === formThemeKey)?.name || formThemeKey}" scheduled successfully!`);
        } else {
          setFormError(res.error || 'Failed to create schedule.');
        }
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save schedule.');
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  // Cancel Schedule
  const handleCancelSchedule = async (scheduleId: string) => {
    setCancellingScheduleId(scheduleId);
    try {
      const res = await cancelCustomerThemeScheduleAction(scheduleId);
      if (res.success && res.schedule) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === scheduleId ? { ...s, status: 'CANCELLED' } : s))
        );
        setSuccessToast('Theme schedule cancelled. Customer QR immediately reverts to baseline theme.');
      } else {
        setErrorMsg(res.error || 'Failed to cancel schedule.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error cancelling schedule.');
    } finally {
      setCancellingScheduleId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-10">
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
            <span className="text-white font-medium">Customer Themes &amp; Scheduling</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <span>Customer Experience &amp; Themes</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-primary/20 text-primary border border-primary/30">
              11 Approved Themes
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Choose permanent themes or schedule occasion and festival themes to activate automatically. Evaluated strictly in your restaurant&apos;s timezone ({timezoneLabel}).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleOpenCreateSchedule()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-blue-600 text-white text-xs font-bold transition-all shadow-md shadow-primary/25 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            <span>Schedule a Theme</span>
          </button>

          <Link
            href="/dashboard/settings/qr"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
            <span>View Customer QR</span>
          </Link>
        </div>
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
            aria-label="Dismiss notification"
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
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Theme Status Overview Grid (Active on QR vs Permanent Base) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Currently Active on QR */}
        <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-[#101726] to-[#0A0E17] p-5 sm:p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Currently Live on Customer QR</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-400 border border-white/10">
                  {effectiveTheme.metadata?.category || 'General'}
                </span>
              </div>

              {isScheduleActive ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Active Schedule Override
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                  Permanent Baseline
                </span>
              )}
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {effectiveTheme.name}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                {effectiveTheme.description}
              </p>
            </div>

            {/* Active Schedule details if schedule is driving QR */}
            {isScheduleActive && activeSchedule && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-300">
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  <span>Active Schedule Window</span>
                </div>
                <div className="text-[11px] text-amber-200/80">
                  From: <span className="font-mono text-white font-medium">{utcToZonedDateTime(activeSchedule.start_at, activeSchedule.timezone).displayStr}</span>
                </div>
                <div className="text-[11px] text-amber-200/80">
                  Until: <span className="font-mono text-white font-medium">{utcToZonedDateTime(activeSchedule.end_at, activeSchedule.timezone).displayStr}</span>
                </div>
                <div className="text-[10px] text-amber-300/70 pt-0.5">
                  When this schedule ends, your QR will automatically return to &quot;{baseTheme.name}&quot;.
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPreviewTheme(effectiveTheme);
                  setPreviewModalMode('preview_only');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                <span>Open Live QR Preview</span>
              </button>
              <div className="text-[11px] text-slate-400 font-mono">
                Key: <span className="text-slate-300 font-bold">{effectiveTheme.key}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 w-full">
            <CustomerThemePreview
              theme={effectiveTheme}
              variant="card"
              restaurantName={restaurantName}
            />
          </div>
        </div>

        {/* Card 2: Permanent Base Theme */}
        <div className="rounded-3xl border border-white/10 bg-[#0E1524] p-5 sm:p-6 shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Permanent Baseline Theme
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-400 border border-white/10">
                  Default Fallback
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {baseTheme.name}
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                This theme serves as your regular presentation whenever no temporary occasion schedule is active.
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-slate-400 space-y-1">
              <div className="text-slate-300 font-semibold">How Scheduling Overrides Work:</div>
              <p className="text-[11px] leading-relaxed">
                You can change this base theme at any time from the library below. If an occasion schedule is running, the scheduled theme remains active on QR until it expires, after which your new baseline immediately takes over.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPreviewTheme(baseTheme);
                  setPreviewModalMode('base');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                <span>Preview Baseline</span>
              </button>
              <div className="text-[11px] text-slate-400 font-mono">
                Key: <span className="text-slate-300 font-bold">{baseTheme.key}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 w-full">
            <CustomerThemePreview
              theme={baseTheme}
              variant="card"
              restaurantName={restaurantName}
            />
          </div>
        </div>
      </div>

      {/* SECTION: Theme Schedules List */}
      <div className="rounded-3xl border border-white/10 bg-[#0E1524] p-5 sm:p-7 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Scheduled Themes
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/5 text-slate-400 border border-white/10">
                {schedules.length} {schedules.length === 1 ? 'Schedule' : 'Schedules'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Occasion and festival themes scheduled for automated activation in {timezoneLabel}.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-[#131B2E] p-1 rounded-xl border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setScheduleTab('ALL')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  scheduleTab === 'ALL' ? 'bg-primary text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({schedules.length})
              </button>
              <button
                type="button"
                onClick={() => setScheduleTab('ACTIVE')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  scheduleTab === 'ACTIVE' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setScheduleTab('UPCOMING')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  scheduleTab === 'UPCOMING' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Upcoming
              </button>
              <button
                type="button"
                onClick={() => setScheduleTab('COMPLETED_OR_CANCELLED')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  scheduleTab === 'COMPLETED_OR_CANCELLED' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Past / Cancelled
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleOpenCreateSchedule()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary hover:bg-blue-600 text-white text-xs font-bold transition-all shadow cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>New Schedule</span>
            </button>
          </div>
        </div>

        {/* Schedules Table / Card List */}
        {filteredSchedules.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-white/10 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-white/5 flex items-center justify-center text-slate-400">
              <span className="material-symbols-outlined text-[24px]">calendar_month</span>
            </div>
            <div>
              <p className="text-sm font-bold text-white">No schedules found in this view</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Schedule Durga Puja, Diwali, Christmas, or Weekend Special themes to switch your customer presentation automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenCreateSchedule()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              <span>Schedule an Occasion Theme</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[11px] font-mono uppercase text-slate-400 tracking-wider">
                  <th className="py-3 px-4">Theme</th>
                  <th className="py-3 px-4">Active Window ({timezoneLabel})</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {filteredSchedules.map((schedule) => {
                  const theme = themes.find((t) => t.key === schedule.theme_key) ?? resolveCustomerTheme(schedule.theme_key);
                  const tz = schedule.timezone || restaurantTimezone || 'UTC';
                  const startFormatted = utcToZonedDateTime(schedule.start_at, tz).displayStr;
                  const endFormatted = utcToZonedDateTime(schedule.end_at, tz).displayStr;

                  const nowMs = now.getTime();
                  const startMs = new Date(schedule.start_at).getTime();
                  const endMs = new Date(schedule.end_at).getTime();
                  const isActive = schedule.status === 'ACTIVE' && startMs <= nowMs && nowMs < endMs;
                  const isUpcoming = schedule.status === 'ACTIVE' && startMs > nowMs;
                  const isCompleted = schedule.status === 'ACTIVE' && endMs <= nowMs;
                  const isCancelled = schedule.status === 'CANCELLED';

                  return (
                    <tr key={schedule.id} className="hover:bg-white/[0.02] transition-colors">
                      {/* Theme details */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-white/10">
                            <CustomerThemePreview theme={theme} variant="card" restaurantName={restaurantName} />
                          </div>
                          <div>
                            <div className="font-bold text-white text-sm flex items-center gap-2">
                              <span>{theme.name}</span>
                              <span className="text-[10px] font-normal text-slate-400 font-mono">({schedule.theme_key})</span>
                            </div>
                            <div className="text-[11px] text-slate-400">{theme.metadata?.category || 'General'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Schedule Window */}
                      <td className="py-3.5 px-4 font-mono text-[11px] space-y-0.5">
                        <div className="text-slate-300">
                          <span className="text-slate-500">Start: </span>{startFormatted}
                        </div>
                        <div className="text-slate-300">
                          <span className="text-slate-500">End:&nbsp;&nbsp; </span>{endFormatted}
                        </div>
                      </td>

                      {/* Status badge */}
                      <td className="py-3.5 px-4">
                        {isActive && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Active on QR</span>
                          </span>
                        )}
                        {isUpcoming && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            <span className="material-symbols-outlined text-[12px]">schedule</span>
                            <span>Upcoming</span>
                          </span>
                        )}
                        {isCompleted && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700">
                            Completed
                          </span>
                        )}
                        {isCancelled && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-300 border border-rose-500/20">
                            Cancelled
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTheme(theme);
                              setPreviewModalMode('preview_only');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all cursor-pointer"
                            title="Preview theme"
                          >
                            Preview
                          </button>

                          {!isCompleted && !isCancelled && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditSchedule(schedule)}
                                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all cursor-pointer"
                                title="Edit schedule interval"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCancelSchedule(schedule.id)}
                                disabled={cancellingScheduleId === schedule.id}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                                title="Cancel schedule"
                              >
                                {cancellingScheduleId === schedule.id ? 'Cancelling...' : 'Cancel'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION: Theme Library (Baseline Theme Grid) */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              Theme Library
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select any of the 11 approved occasion and festival themes to set as your baseline or schedule for upcoming dates.
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
            const isBase = theme.key === baseThemeKey;
            const isEffective = theme.key === effectiveTheme.key;
            const isThemeSaving = isSavingBase && savingBaseThemeKey === theme.key;

            return (
              <div
                key={theme.key}
                className={`rounded-3xl border bg-[#0E1524] p-4 flex flex-col justify-between gap-4 transition-all duration-200 group relative overflow-hidden ${
                  isEffective
                    ? 'border-emerald-500/60 shadow-[0_0_25px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/40'
                    : isBase
                    ? 'border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.12)]'
                    : 'border-white/10 hover:border-white/20 hover:shadow-xl'
                }`}
              >
                {/* Status Badges */}
                <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
                  {isEffective && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950 font-sans shadow-md flex items-center gap-1">
                      <span>✓ Live on QR</span>
                    </span>
                  )}
                  {isBase && !isEffective && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      Base Theme
                    </span>
                  )}
                </div>

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
                    <h3 className="font-bold text-base text-white tracking-tight group-hover:text-primary transition-colors">
                      {theme.name}
                    </h3>
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
                    onClick={() => {
                      setPreviewTheme(theme);
                      setPreviewModalMode('base');
                    }}
                    disabled={isSavingBase}
                    className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all text-center cursor-pointer"
                  >
                    Preview
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenCreateSchedule(theme.key)}
                    disabled={isSavingBase}
                    className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 hover:text-white text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1"
                    title="Schedule this theme for specific dates"
                  >
                    <span className="material-symbols-outlined text-[14px]">calendar_add_on</span>
                    <span>Schedule</span>
                  </button>

                  {isBase ? (
                    <div className="flex-1 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-bold text-center flex items-center justify-center gap-1">
                      <span>✓ Base</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSelectBaseTheme(theme.key)}
                      disabled={isSavingBase}
                      className="flex-1 py-2 rounded-xl bg-primary hover:bg-blue-500 active:bg-blue-600 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 text-center cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isThemeSaving ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <span>Set Base</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SCHEDULE CREATE / EDIT MODAL */}
      {isScheduleModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-modal-title"
        >
          <div className="bg-[#101726] border border-white/15 rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl space-y-6 relative">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 id="schedule-modal-title" className="text-lg font-black text-white tracking-tight flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-primary">calendar_month</span>
                  <span>{editingSchedule ? 'Edit Theme Schedule' : 'Schedule an Occasion Theme'}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure automatic activation window in {timezoneLabel}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSchedule} className="space-y-4">
              {/* Theme Selector */}
              <div>
                <label htmlFor="schedule-theme-select" className="block text-xs font-bold text-slate-300 mb-1.5">
                  Select Theme (11 Approved Themes)
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="schedule-theme-select"
                    value={formThemeKey}
                    onChange={(e) => setFormThemeKey(e.target.value)}
                    className="flex-1 bg-[#131B2E] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-primary font-medium"
                  >
                    {themes.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name} ({t.metadata?.category || 'General'})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      const sel = themes.find((t) => t.key === formThemeKey);
                      if (sel) {
                        setPreviewTheme(sel);
                        setPreviewModalMode('preview_only');
                      }
                    }}
                    className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                  >
                    Preview
                  </button>
                </div>
              </div>

              {/* Start Date & Time */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  Start Date &amp; Time ({timezoneLabel})
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    required
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="bg-[#131B2E] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
                  />
                  <input
                    type="time"
                    required
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="bg-[#131B2E] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* End Date & Time */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  End Date &amp; Time ({timezoneLabel})
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    required
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="bg-[#131B2E] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
                  />
                  <input
                    type="time"
                    required
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="bg-[#131B2E] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Timezone Notice */}
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-[11px] text-slate-400 space-y-1">
                <div className="flex items-center gap-1 text-slate-300 font-semibold">
                  <span className="material-symbols-outlined text-[14px]">public</span>
                  <span>Restaurant Timezone Authoritative</span>
                </div>
                <p>
                  Schedules evaluate against your outlet&apos;s configured timezone ({timezoneLabel}). Overlapping active schedules are prevented.
                </p>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsScheduleModalOpen(false)}
                  disabled={isSubmittingSchedule}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSchedule}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-blue-600 text-white text-xs font-bold shadow-md transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {isSubmittingSchedule ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Saving Schedule...</span>
                    </>
                  ) : (
                    <span>{editingSchedule ? 'Update Schedule' : 'Schedule Theme'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FULL PREVIEW MODAL */}
      <CustomerThemePreviewModal
        isOpen={Boolean(previewTheme)}
        onClose={() => setPreviewTheme(null)}
        theme={previewTheme}
        restaurantName={restaurantName}
        isActiveTheme={previewTheme?.key === effectiveTheme.key}
        onSelectTheme={previewModalMode === 'base' ? handleSelectBaseTheme : undefined}
        hideSelectButton={previewModalMode === 'preview_only'}
        isSaving={isSavingBase}
      />
    </div>
  );
}

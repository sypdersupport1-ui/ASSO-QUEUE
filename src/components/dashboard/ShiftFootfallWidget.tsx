'use client';

import React, { useState } from 'react';
import type { ShiftFootfallReport, FootfallSlot } from '@/lib/services/analytics-service';

interface ShiftFootfallWidgetProps {
  report: ShiftFootfallReport;
}

export function ShiftFootfallWidget({ report }: ShiftFootfallWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<FootfallSlot | null>(
    report.currentSlot || report.peakSlot || report.slots[2] || null
  );

  // Calculate max guests among slots for normalized bar height (min 10 for nice appearance)
  const maxSlotGuests = Math.max(10, ...report.slots.map((s) => s.totalGuests));

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0E131F]/90 p-5 sm:p-6 shadow-2xl backdrop-blur-xl transition-all">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

      {/* Top Header */}
      <div className={`relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isExpanded ? 'border-b border-white/5 pb-4 mb-6' : ''}`}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
              5 AM → 5 AM Shift Telemetry
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-mono font-bold text-slate-400">
              {report.shiftDate}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
            <span>Operating Day Footfall</span>
            <span className="text-xs font-normal text-slate-400 hidden md:inline">· 24-Hour Cycle Breakdown</span>
          </h2>
        </div>

        {/* Quick Shift Summary Cards + Collapse Toggle */}
        <div className="flex items-center gap-2.5 sm:gap-3 overflow-x-auto pb-1 sm:pb-0">
          <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/5 px-3 py-1.5 sm:px-3.5 sm:py-2 shrink-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Footfall</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base sm:text-lg font-black text-white font-mono">{report.totalFootfall}</span>
              <span className="text-[10px] sm:text-[11px] text-slate-400">guests</span>
            </div>
          </div>

          <div className="flex flex-col rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 sm:px-3.5 sm:py-2 shrink-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-emerald-300 uppercase tracking-wider">Seated</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base sm:text-lg font-black text-emerald-400 font-mono">{report.totalSeatedFootfall}</span>
              <span className="text-[9px] sm:text-[10px] font-bold text-emerald-500/80">({report.seatedConversionRate}%)</span>
            </div>
          </div>

          {report.peakSlot && report.peakSlot.totalGuests > 0 && (
            <div className="flex flex-col rounded-2xl bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 sm:px-3.5 sm:py-2 shrink-0">
              <span className="text-[9px] sm:text-[10px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1">
                <span>🔥 Peak</span>
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs sm:text-sm font-black text-amber-400 font-mono">{report.peakSlot.slotKey.split(' - ')[0]}</span>
                <span className="text-[9px] sm:text-[10px] text-amber-300">({report.peakSlot.totalGuests}g)</span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-3 py-2 rounded-2xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] active:bg-white/20 text-xs font-bold text-slate-200 transition-all cursor-pointer shrink-0 shadow-sm"
            aria-expanded={isExpanded}
            title={isExpanded ? 'Collapse 24h slots' : 'Expand 24h slots'}
          >
            <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
            <span
              className="material-symbols-outlined text-[16px] transition-transform duration-200"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }}
            >
              expand_more
            </span>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="animate-in fade-in duration-300">
          {/* 8 Slot Timeline Bars */}
          <div className="relative z-10 mb-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
          <span>Service Slots Across 24h Operating Shift</span>
          <span className="text-[10px] text-slate-500">Click a slot for details</span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
          {report.slots.map((slot) => {
            const isSelected = selectedSlot?.slotKey === slot.slotKey;
            const barHeightPct = Math.max(14, Math.round((slot.totalGuests / maxSlotGuests) * 100));

            return (
              <button
                key={slot.slotKey}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                className={`group relative flex flex-col justify-between rounded-2xl p-2.5 sm:p-3 text-left transition-all cursor-pointer border ${
                  isSelected
                    ? 'border-cyan-400/60 bg-cyan-950/40 shadow-[0_0_20px_rgba(34,211,238,0.15)] ring-1 ring-cyan-400/50'
                    : slot.isCurrent
                    ? 'border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-400/60'
                    : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15'
                }`}
              >
                {/* Top: Slot title & badges */}
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] font-black text-white">{slot.slotKey.split(' - ')[0]}</span>
                    {slot.isCurrent && (
                      <span className="px-1 py-0.2 rounded bg-emerald-500 text-[8px] font-black text-slate-950 uppercase tracking-tighter">
                        Now
                      </span>
                    )}
                    {slot.isPeak && !slot.isCurrent && (
                      <span className="text-[10px]">🔥</span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-400 truncate leading-tight font-medium">
                    {slot.label}
                  </span>
                </div>

                {/* Middle: Visual bar */}
                <div className="my-2.5 h-16 w-full flex items-end rounded-lg bg-black/30 p-1">
                  <div
                    className={`w-full rounded-md transition-all duration-500 relative overflow-hidden ${
                      slot.isPeak
                        ? 'bg-gradient-to-t from-amber-600 via-orange-500 to-amber-300'
                        : slot.isCurrent
                        ? 'bg-gradient-to-t from-emerald-600 via-teal-500 to-cyan-400'
                        : slot.totalGuests > 0
                        ? 'bg-gradient-to-t from-blue-600 to-cyan-400'
                        : 'bg-slate-800'
                    }`}
                    style={{ height: `${barHeightPct}%` }}
                  >
                    {slot.totalGuests > 0 && (
                      <div className="absolute inset-0 bg-white/15 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </div>

                {/* Bottom: Count */}
                <div className="flex items-baseline justify-between pt-1 border-t border-white/5">
                  <span className="font-mono text-xs font-black text-white">
                    {slot.totalGuests}
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {slot.partyCount}p
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Slot Detailed Intel Card */}
      {selectedSlot && (
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl bg-white/[0.03] border border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-2xl flex items-center justify-center font-mono font-black text-sm shrink-0 shadow-lg ${
              selectedSlot.isPeak
                ? 'bg-amber-500 text-slate-950 shadow-amber-500/20'
                : selectedSlot.isCurrent
                ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
            }`}>
              {selectedSlot.isPeak ? '🔥' : selectedSlot.isCurrent ? '⚡' : '⏱️'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white font-mono">{selectedSlot.slotKey}</span>
                <span className="text-xs font-semibold text-cyan-300">({selectedSlot.label})</span>
                {selectedSlot.isCurrent && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                    Active Shift Window
                  </span>
                )}
                {selectedSlot.isPeak && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                    Busiest Rush Hour
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedSlot.totalGuests === 0
                  ? 'No guest entries recorded in this shift window yet.'
                  : `${selectedSlot.totalGuests} guests arrived across ${selectedSlot.partyCount} parties (${selectedSlot.seatedGuests} successfully seated).`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center">
            <div className="text-right">
              <div className="text-xs text-slate-400 font-medium">Slot Seated Conversion</div>
              <div className="text-sm font-mono font-black text-emerald-400">
                {selectedSlot.totalGuests > 0
                  ? `${Math.round((selectedSlot.seatedGuests / selectedSlot.totalGuests) * 100)}%`
                  : '0%'}
              </div>
            </div>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
}

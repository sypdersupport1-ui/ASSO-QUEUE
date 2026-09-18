'use client';

import React, { useState } from 'react';

export interface QueueHealthData {
  health: 'HEALTHY' | 'BUSY' | 'CRITICAL' | 'EMPTY' | 'PAUSED' | 'CLOSED';
  healthReason: string;
  activeCount: number;
  waitingCount: number;
  notifiedCount: number;
  calledCount: number;
  overdueCount: number;
  oldestWaitingAgeMins: number | null;
  avgWaitMins: number | null;
  availableTables: number;
  totalTables: number;
  occupiedTables: number;
  cleaningTables: number;
  reservedTables: number;
  outOfServiceTables: number;
  operatingState: string;
  queueEnabled: boolean;
  dineInWaitingCount?: number;
  takeawayWaitingCount?: number;
  dineInActiveCount?: number;
  takeawayActiveCount?: number;
}

interface CollapsibleQueueHealthProps {
  queueHealth: QueueHealthData;
  maxQueueCapacity: number;
  callTimeoutMinutes: number;
}

export function CollapsibleQueueHealth({
  queueHealth,
  maxQueueCapacity,
  callTimeoutMinutes,
}: CollapsibleQueueHealthProps) {
  // Requirement: Default collapsed!
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusTheme = () => {
    switch (queueHealth.health) {
      case 'HEALTHY':
        return {
          border: 'border-emerald-500/25 hover:border-emerald-500/40',
          bg: 'bg-gradient-to-r from-emerald-950/40 via-[#0C181C] to-slate-900/90',
          dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
          badge: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
          text: 'text-emerald-400',
        };
      case 'BUSY':
        return {
          border: 'border-amber-500/25 hover:border-amber-500/40',
          bg: 'bg-gradient-to-r from-amber-950/40 via-[#18130B] to-slate-900/90',
          dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]',
          badge: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
          text: 'text-amber-400',
        };
      case 'CRITICAL':
        return {
          border: 'border-rose-500/35 hover:border-rose-500/50',
          bg: 'bg-gradient-to-r from-rose-950/40 via-[#1A0B10] to-slate-900/90',
          dot: 'bg-rose-500 animate-ping',
          badge: 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse',
          text: 'text-rose-400',
        };
      case 'EMPTY':
        return {
          border: 'border-slate-700/40 hover:border-slate-600',
          bg: 'bg-gradient-to-r from-slate-900/80 via-[#111827] to-slate-900/80',
          dot: 'bg-slate-400',
          badge: 'bg-slate-800 border-slate-700 text-slate-300',
          text: 'text-slate-300',
        };
      default:
        return {
          border: 'border-amber-500/25 hover:border-amber-500/40',
          bg: 'bg-gradient-to-r from-amber-950/30 via-[#161210] to-slate-900/90',
          dot: 'bg-amber-400',
          badge: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
          text: 'text-amber-400',
        };
    }
  };

  const theme = getStatusTheme();

  return (
    <div
      className={`rounded-2xl border transition-all duration-300 shadow-md ${theme.border} ${theme.bg} overflow-hidden`}
    >
      {/* Header bar — ALWAYS visible & clickable to toggle */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
      >
        {/* Left: Health Indicator & Title */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="relative flex items-center justify-center shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full ${theme.dot}`} />
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h3 className="text-xs font-black uppercase tracking-widest text-white">
              Queue Health — <span className={theme.text}>{queueHealth.health}</span>
            </h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border truncate ${theme.badge}`}>
              {queueHealth.healthReason}
            </span>
          </div>
        </div>

        {/* Right: Glanceable stats + Expand/Collapse Button */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-2 text-[11px] font-semibold text-slate-300">
            <span className="px-2 py-0.5 rounded-lg bg-black/30 border border-white/5">
              👥 {queueHealth.activeCount}/{maxQueueCapacity} active
              {typeof queueHealth.dineInActiveCount === 'number' && typeof queueHealth.takeawayActiveCount === 'number' && (
                <span className="text-slate-400 font-normal ml-1">
                  ({queueHealth.dineInActiveCount} dine-in · {queueHealth.takeawayActiveCount} takeaway)
                </span>
              )}
            </span>
            <span className="px-2 py-0.5 rounded-lg bg-black/30 border border-white/5">
              🪑 {queueHealth.availableTables}/{queueHealth.totalTables} ready
            </span>
            {queueHealth.overdueCount > 0 && (
              <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 font-bold">
                ⚠️ {queueHealth.overdueCount} overdue
              </span>
            )}
          </div>

          <button
            type="button"
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300 transition-all cursor-pointer"
            aria-label={isExpanded ? 'Collapse queue health' : 'Expand queue health'}
          >
            <span className="text-[11px] hidden sm:inline">{isExpanded ? 'Hide' : 'Details'}</span>
            <span className="material-symbols-outlined text-[18px] transition-transform duration-200">
              {isExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
            </span>
          </button>
        </div>
      </div>

      {/* Collapsed view summary bar on mobile */}
      {!isExpanded && (
        <div className="md:hidden px-3.5 pb-3 flex items-center justify-between text-[10px] text-slate-400 border-t border-white/5 pt-2">
          <span>👥 {queueHealth.activeCount} active ({queueHealth.dineInActiveCount ?? queueHealth.activeCount} dine-in · {queueHealth.takeawayActiveCount ?? 0} takeaway)</span>
          <span>🪑 {queueHealth.availableTables} tables ready</span>
        </div>
      )}

      {/* Expanded detailed metric view */}
      {isExpanded && (
        <div className="p-4 pt-1 border-t border-white/10 flex flex-col gap-3 animate-fadeIn">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            {/* Active Depth */}
            <div className="bg-black/30 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Line Depth</div>
              <div className="text-xl font-black text-white mt-1">
                {queueHealth.activeCount}{' '}
                <span className="text-xs font-normal text-slate-400">/ {maxQueueCapacity} max</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                <span className="text-white font-bold">{queueHealth.waitingCount}</span> waiting (
                <span className="text-cyan-300">{queueHealth.dineInWaitingCount ?? queueHealth.waitingCount}</span> dine-in •{' '}
                <span className="text-amber-300">{queueHealth.takeawayWaitingCount ?? 0}</span> takeaway) •{' '}
                <span className="text-purple-300 font-bold">{queueHealth.notifiedCount}</span> notified •{' '}
                <span className="text-blue-300 font-bold">{queueHealth.calledCount}</span> called
              </div>
            </div>

            {/* Overdue */}
            <div className="bg-black/30 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overdue Calls</div>
              <div
                className={`text-xl font-black mt-1 ${
                  queueHealth.overdueCount > 0 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
                }`}
              >
                {queueHealth.overdueCount}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Call timeout: <span className="text-white font-bold">{callTimeoutMinutes}m</span>
              </div>
            </div>

            {/* Wait Times */}
            <div className="bg-black/30 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Oldest In Line</div>
              <div className="text-xl font-black text-white mt-1">
                {queueHealth.oldestWaitingAgeMins !== null ? `${queueHealth.oldestWaitingAgeMins}m` : '—'}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Avg wait: <span className="text-white font-bold">~{queueHealth.avgWaitMins ?? '—'}m</span>
              </div>
            </div>

            {/* Tables Capacity */}
            <div className="bg-black/30 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Table Matrix</div>
              <div className="text-xl font-black text-emerald-400 mt-1">
                {queueHealth.availableTables}{' '}
                <span className="text-xs font-normal text-slate-400">/ {queueHealth.totalTables} ready</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1 truncate">
                {queueHealth.occupiedTables} occ • {queueHealth.cleaningTables} clean • {queueHealth.reservedTables} res
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-white/5">
            <span>
              Operating Mode: <b className="text-slate-200">{queueHealth.operatingState}</b>{' '}
              {queueHealth.queueEnabled ? '' : '(Queue Disabled)'}
            </span>
            <span className="text-slate-500 hidden sm:inline">Priority: CLOSED &gt; PAUSED &gt; CRITICAL &gt; BUSY &gt; HEALTHY</span>
          </div>
        </div>
      )}
    </div>
  );
}

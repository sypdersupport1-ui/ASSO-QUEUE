'use client';

import React, { useState } from 'react';

interface ScheduleDayRow {
  day_of_week: number;
  opens_at?: string | null;
  closes_at?: string | null;
  is_closed?: boolean;
}

interface ScheduleAvailability {
  localTimeStr: string;
  scheduledOpen: boolean;
  nextOpening?: {
    dayOffset: number;
    dayLabel: string;
    opensAt12h: string;
  } | null;
}

interface CollapsibleQueueScheduleProps {
  scheduleInfo: {
    schedule: ScheduleDayRow[];
    availability: ScheduleAvailability;
  } | null;
  updateAction: (formData: FormData) => Promise<void>;
  timezone: string;
}

export function CollapsibleQueueSchedule({
  scheduleInfo,
  updateAction,
  timezone,
}: CollapsibleQueueScheduleProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="p-4 rounded-2xl bg-[#111827] border border-white/5 flex flex-col gap-3 shadow-sm transition-all">
      {/* Header bar with summary & collapse toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-blue-400">schedule</span>
          <h3 className="text-xs font-black text-white uppercase tracking-widest">
            Queue Operating Timings & Schedule
          </h3>
          {scheduleInfo && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                scheduleInfo.availability.scheduledOpen
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              {scheduleInfo.availability.scheduledOpen ? 'Within Hours' : 'Outside Hours'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          {scheduleInfo && (
            <span className="text-[11px] text-slate-400 hidden md:inline">
              Local: <b className="text-white font-mono">{scheduleInfo.availability.localTimeStr}</b>
              {scheduleInfo.availability.nextOpening && !scheduleInfo.availability.scheduledOpen && (
                <span className="text-slate-400">
                  {' '}• Opens {scheduleInfo.availability.nextOpening.dayOffset === 0 ? 'today' : scheduleInfo.availability.nextOpening.dayLabel} {scheduleInfo.availability.nextOpening.opensAt12h}
                </span>
              )}
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.05] hover:bg-white/[0.1] active:bg-white/15 text-xs font-bold text-slate-200 transition-all cursor-pointer shadow-sm"
            aria-expanded={isExpanded}
            title={isExpanded ? 'Collapse weekly schedule' : 'Expand weekly schedule'}
          >
            <span>{isExpanded ? 'Collapse' : 'Weekly Timings'}</span>
            <span
              className="material-symbols-outlined text-[16px] transition-transform duration-200"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }}
            >
              expand_more
            </span>
          </button>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="pt-2 border-t border-white/5 animate-in fade-in duration-200 flex flex-col gap-3">
          {scheduleInfo ? (
            <form action={updateAction}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, d) => {
                  const row = scheduleInfo.schedule.find((r) => r.day_of_week === d);
                  return (
                    <div key={d} className="p-3 rounded-xl bg-black/20 border border-white/5 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white">{label}</span>
                        <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                          <input
                            type="checkbox"
                            name={`closed_${d}`}
                            defaultChecked={row?.is_closed}
                            className="accent-rose-500"
                          />{' '}
                          Closed
                        </label>
                      </div>
                      <label className="text-[10px] text-slate-500">
                        Opens
                        <input
                          type="time"
                          name={`opens_${d}`}
                          defaultValue={row?.opens_at || '00:00'}
                          className="mt-1 w-full h-9 rounded-lg bg-[#0A0E17] border border-white/10 text-white text-xs px-2 font-mono"
                        />
                      </label>
                      <label className="text-[10px] text-slate-500">
                        Closes
                        <input
                          type="time"
                          name={`closes_${d}`}
                          defaultValue={row?.closes_at || '23:59'}
                          className="mt-1 w-full h-9 rounded-lg bg-[#0A0E17] border border-white/10 text-white text-xs px-2 font-mono"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-3">
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-white text-sm font-bold rounded-lg transition-colors shadow-sm cursor-pointer"
                >
                  Save Schedule
                </button>
              </div>
            </form>
          ) : (
            <p className="text-xs text-slate-500">Schedule unavailable.</p>
          )}
          <p className="text-[11px] text-slate-500">
            Times are restaurant-local ({timezone}). Cross-midnight like 22:00 → 01:00 supported.
            Manual PAUSED/CLOSED always wins over schedule; schedule never reopens a paused queue.
          </p>
        </div>
      )}
    </div>
  );
}

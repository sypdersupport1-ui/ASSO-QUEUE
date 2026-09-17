'use client';

import React, { useState } from 'react';
import { CollapsibleQueueSchedule } from './CollapsibleQueueSchedule';
import { CollapsibleQueueHealth, QueueHealthData } from './CollapsibleQueueHealth';

interface QueueOperationsAccordionProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduleInfo: any;
  updateQueueScheduleFormAction: (formData: FormData) => Promise<void>;
  timezone: string;
  queueHealth: QueueHealthData;
  maxQueueCapacity: number;
  callTimeoutMinutes: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  restaurant: any;
  userId: string;
  updateQueueSettingsFormAction: (formData: FormData) => Promise<void>;
  updateETASettingsFormAction: (formData: FormData) => Promise<void>;
}

export function QueueOperationsAccordion({
  scheduleInfo,
  updateQueueScheduleFormAction,
  timezone,
  queueHealth,
  maxQueueCapacity,
  callTimeoutMinutes,
  restaurant,
  userId,
  updateQueueSettingsFormAction,
  updateETASettingsFormAction,
}: QueueOperationsAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'schedule' | 'health' | 'config'>('schedule');

  return (
    <div className="rounded-2xl bg-[#111827] border border-white/10 shadow-sm flex flex-col overflow-hidden transition-all">
      {/* Header Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-slate-400 text-[20px]">tune</span>
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase tracking-widest text-slate-200">
              Operations &amp; Settings
            </span>
            <span className="text-[10px] text-slate-400">
              Schedule • Diagnostics • Limits &amp; ETA
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">
            {isOpen ? 'Collapse' : 'Expand'}
          </span>
          <span
            className={`material-symbols-outlined text-slate-400 text-[18px] transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {/* Expanded Accordion Body */}
      {isOpen && (
        <div className="p-4 pt-0 border-t border-white/10 flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Sub-tabs */}
          <div className="flex items-center gap-1.5 pt-3 border-b border-white/5 pb-2">
            {[
              { id: 'schedule', label: 'Schedule', icon: 'schedule' },
              { id: 'health', label: 'Health', icon: 'monitor_heart' },
              { id: 'config', label: 'Limits & ETA', icon: 'settings' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)} // eslint-disable-line @typescript-eslint/no-explicit-any
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab 1: Schedule */}
          {activeTab === 'schedule' && (
            <div className="flex flex-col gap-2">
              <CollapsibleQueueSchedule
                scheduleInfo={scheduleInfo}
                updateAction={updateQueueScheduleFormAction}
                timezone={timezone}
              />
            </div>
          )}

          {/* Tab 2: Health */}
          {activeTab === 'health' && (
            <div className="flex flex-col gap-2">
              <CollapsibleQueueHealth
                queueHealth={queueHealth}
                maxQueueCapacity={maxQueueCapacity}
                callTimeoutMinutes={callTimeoutMinutes}
              />
            </div>
          )}

          {/* Tab 3: Config (Limits & ETA) */}
          {activeTab === 'config' && (
            <div className="flex flex-col gap-4">
              {/* Queue Limits */}
              <div className="bg-[#0A0E17] rounded-xl p-3.5 border border-white/5 flex flex-col gap-2.5">
                <span className="text-[11px] font-black text-white uppercase tracking-wider">
                  Capacity Boundaries
                </span>
                <form action={updateQueueSettingsFormAction} className="flex flex-col gap-3">
                  <input type="hidden" name="restaurantId" value={restaurant.id} />
                  <input type="hidden" name="actorUserId" value={userId} />

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">
                        Max Capacity
                      </label>
                      <input
                        type="number"
                        name="maxQueueCapacity"
                        defaultValue={restaurant.max_queue_capacity ?? 100}
                        min={1}
                        max={1000}
                        required
                        className="w-full bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">
                        Call Timeout
                      </label>
                      <input
                        type="number"
                        name="callTimeoutMinutes"
                        defaultValue={restaurant.call_timeout_minutes ?? 15}
                        min={1}
                        max={120}
                        required
                        className="w-full bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 pt-1 border-t border-white/5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        name="autoExpireCalled"
                        value="true"
                        defaultChecked={restaurant.auto_expire_called === true}
                        className="h-4 w-4 rounded border-white/20 bg-[#111827] text-blue-500 focus:ring-blue-500/30"
                      />
                      <span className="text-[11px] font-bold text-slate-300">
                        Auto-remove from queue on timeout
                      </span>
                    </label>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Kept OFF (recommended): Guests who reach timeout stay in the active queue marked as &ldquo;Overdue&rdquo; so staff can seat them or manually mark no-show.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="self-end px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Save Limits
                  </button>
                </form>
              </div>

              {/* ETA Settings */}
              <div className="bg-[#0A0E17] rounded-xl p-3.5 border border-white/5 flex flex-col gap-2.5">
                <span className="text-[11px] font-black text-white uppercase tracking-wider">
                  ETA Calibration
                </span>
                <form action={updateETASettingsFormAction} className="flex flex-col gap-3">
                  <input type="hidden" name="restaurantId" value={restaurant.id} />
                  <input type="hidden" name="actorUserId" value={userId} />

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">
                        Avg Service (min)
                      </label>
                      <input
                        type="number"
                        name="avgServiceTimeMins"
                        defaultValue={restaurant.avg_service_time_mins ?? 15}
                        min={1}
                        max={180}
                        required
                        className="w-full bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">
                        Capacity Units
                      </label>
                      <input
                        type="number"
                        name="serviceCapacityUnits"
                        defaultValue={restaurant.service_capacity_units ?? 3}
                        min={1}
                        max={50}
                        required
                        className="w-full bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="self-end px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Save ETA
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

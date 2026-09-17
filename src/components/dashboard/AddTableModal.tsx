'use client';

import React, { useState } from 'react';
import { createTableFormAction, bulkCreateTableFormAction } from '@/app/dashboard/actions';

interface Zone {
  id: string;
  name: string;
}

export function AddTableModal({ zones }: { zones: Zone[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsPending(true);
    const formData = new FormData(e.currentTarget);
    try {
      if (mode === 'single') {
        await createTableFormAction(formData);
      } else {
        await bulkCreateTableFormAction(formData);
      }
      setIsOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold text-sm border border-emerald-500/30 transition-colors shadow-sm ml-auto sm:ml-2 cursor-pointer"
      >
        <span className="material-symbols-outlined text-[16px]">add</span> Add Table
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-[#0A0E17] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 relative text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-[22px]">table_restaurant</span>
                <h3 className="text-lg font-bold">Add Table to Floor</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="flex items-center p-1 rounded-xl bg-[#111827] border border-white/5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`flex-1 py-1.5 rounded-lg text-center transition-all ${
                  mode === 'single' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Single Table
              </button>
              <button
                type="button"
                onClick={() => setMode('bulk')}
                className={`flex-1 py-1.5 rounded-lg text-center transition-all ${
                  mode === 'bulk' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Bulk Generate
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {mode === 'single' ? (
                <>
                  <div className="space-y-1">
                    <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      Table Number / Label
                    </label>
                    <input
                      type="text"
                      name="tableNumber"
                      required
                      placeholder="e.g. T12 or VIP-1"
                      className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Capacity
                      </label>
                      <input
                        type="number"
                        name="capacity"
                        defaultValue="4"
                        min="1"
                        max="50"
                        required
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Shape
                      </label>
                      <select
                        name="shape"
                        defaultValue="RECTANGLE"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-2 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      >
                        <option value="RECTANGLE">Rectangle</option>
                        <option value="ROUND">Round</option>
                        <option value="SQUARE">Square</option>
                        <option value="BAR">Bar</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Zone
                      </label>
                      <select
                        name="zoneId"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-2 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      >
                        <option value="">Main Floor</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Table Prefix
                      </label>
                      <input
                        type="text"
                        name="prefix"
                        placeholder="e.g. T"
                        defaultValue="T"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Start Number
                      </label>
                      <input
                        type="number"
                        name="startNumber"
                        defaultValue="1"
                        min="1"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        How Many Tables?
                      </label>
                      <input
                        type="number"
                        name="count"
                        defaultValue="5"
                        min="1"
                        max="50"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Seats Per Table
                      </label>
                      <input
                        type="number"
                        name="capacity"
                        defaultValue="4"
                        min="1"
                        max="50"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Assign to Zone
                      </label>
                      <select
                        name="zoneId"
                        required
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      >
                        <option value="">Select Zone...</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        Table Shape
                      </label>
                      <select
                        name="shape"
                        defaultValue="RECTANGLE"
                        className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500 text-sm"
                      >
                        <option value="RECTANGLE">Rectangle</option>
                        <option value="ROUND">Round</option>
                        <option value="SQUARE">Square</option>
                        <option value="BAR">Bar</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 rounded-xl bg-transparent hover:bg-white/5 text-slate-400 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 transition-all"
                >
                  {isPending ? 'Saving...' : mode === 'single' ? 'Create Table' : 'Generate Tables'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

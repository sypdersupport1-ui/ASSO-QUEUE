'use client';

import React, { useState } from 'react';
import { adminAddQueueGuestAction } from '@/app/dashboard/actions';

interface AddQueueGuestModalProps {
  label?: string;
  triggerClassName?: string;
  icon?: string;
}

export function AddQueueGuestModal({
  label = 'Manual Add (+)',
  triggerClassName,
  icon = 'person_add',
}: AddQueueGuestModalProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsPending(true);
    const formData = new FormData(e.currentTarget);
    try {
      await adminAddQueueGuestAction(formData);
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
        className={
          triggerClassName ||
          'flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#111827] hover:bg-white/5 border border-white/10 text-slate-300 text-sm font-bold transition-all cursor-pointer active:scale-95'
        }
      >
        <span className="material-symbols-outlined text-[18px] text-blue-400">{icon}</span>
        <span>{label}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-[#0A0E17] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 relative text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-400 text-[22px]">person_add</span>
                <h3 className="text-lg font-bold">Add Guest to Queue</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  Customer Name *
                </label>
                <input
                  type="text"
                  name="customerName"
                  required
                  placeholder="e.g. Ananya Roy"
                  className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    name="customerPhone"
                    placeholder="+91 9876543210"
                    className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    Party Size *
                  </label>
                  <input
                    type="number"
                    name="partySize"
                    defaultValue="2"
                    min="1"
                    max="30"
                    required
                    className="w-full bg-[#111827] border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
              </div>

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
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-blue-600/20 transition-all"
                >
                  {isPending ? 'Adding Guest...' : 'Add to Queue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

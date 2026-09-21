'use client';

import React from 'react';
import { chimeEngine } from '@/lib/audio-chime';

export function NotifyNextHeroButton() {
  return (
    <button
      type="submit"
      onClick={() => {
        chimeEngine.playCallChime();
      }}
      className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-95 text-white font-black text-xs shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer border border-blue-400/30"
    >
      <span className="material-symbols-outlined text-[16px]">notifications_active</span>
      <span>Notify Next — Table Almost Ready</span>
    </button>
  );
}

"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface MobileNavigationProps {
  activeQueueCount: number;
}

export default function MobileNavigation({ activeQueueCount }: MobileNavigationProps) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(path);
  };

  return (
    <>
      {/* Dimmed Background Overlay when Drawer is open */}
      {isDrawerOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm transition-opacity"
          onClick={() => setIsDrawerOpen(false)}
        />
      )}

      {/* Slide-Up Drawer for "More" Menu */}
      <div 
        className={`md:hidden fixed bottom-0 left-0 right-0 bg-[#0A0E17]/95 backdrop-blur-xl border-t border-white/10 z-[70] transition-transform duration-300 ease-in-out ${
          isDrawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <div className="flex flex-col p-4 gap-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-bold text-lg">Menu</h3>
            <button 
              onClick={() => setIsDrawerOpen(false)}
              className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Link onClick={() => setIsDrawerOpen(false)} href="/dashboard/tables" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[24px]">table_restaurant</span>
              <span className="text-xs font-medium">Table Map</span>
            </Link>
            <Link onClick={() => setIsDrawerOpen(false)} href="/dashboard/staff" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[24px]">badge</span>
              <span className="text-xs font-medium">Staff</span>
            </Link>

            <Link onClick={() => setIsDrawerOpen(false)} href="/dashboard/settings/qr" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[24px]">qr_code</span>
              <span className="text-xs font-medium">QR Codes</span>
            </Link>
            <Link onClick={() => setIsDrawerOpen(false)} href="/dashboard/menu" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[24px]">menu_book</span>
              <span className="text-xs font-medium">Menu Configuration</span>
            </Link>
            <Link onClick={() => setIsDrawerOpen(false)} href="/dashboard/profile" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[24px]">tune</span>
              <span className="text-xs font-medium">Venue Settings</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar - Floating & Glassmorphic with safe-area */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3 safe-pb" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <nav 
          className="flex items-center justify-around px-1.5 py-2 bg-[#0A0E17]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/60 mx-auto max-w-sm"
        >
          <Link 
            href="/dashboard" 
            onClick={() => setIsDrawerOpen(false)}
            className={`flex flex-col items-center justify-center min-w-[60px] h-12 rounded-xl transition-all duration-200 active:scale-95 ${
              isActive('/dashboard') ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 active:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">grid_view</span>
            <span className="text-[10px] font-bold mt-0.5 leading-none">Home</span>
          </Link>
          <Link 
            href="/dashboard/queue" 
            onClick={() => setIsDrawerOpen(false)}
            className={`flex flex-col items-center justify-center min-w-[60px] h-12 rounded-xl relative transition-all duration-200 active:scale-95 ${
              isActive('/dashboard/queue') ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 active:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">people</span>
            <span className="text-[10px] font-bold mt-0.5 leading-none">Queue</span>
            {activeQueueCount > 0 && (
              <span className="absolute -top-0.5 right-1 w-5 h-5 bg-rose-500 text-white text-[10px] font-black rounded-full border-2 border-[#0A0E17] flex items-center justify-center">{activeQueueCount > 9 ? '9+' : activeQueueCount}</span>
            )}
          </Link>
          <Link 
            href="/dashboard/orders" 
            onClick={() => setIsDrawerOpen(false)}
            className={`flex flex-col items-center justify-center min-w-[60px] h-12 rounded-xl transition-all duration-200 active:scale-95 ${
              isActive('/dashboard/orders') ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 active:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">receipt_long</span>
            <span className="text-[10px] font-bold mt-0.5 leading-none">Orders</span>
          </Link>
          <Link 
            href="/dashboard/kitchen" 
            onClick={() => setIsDrawerOpen(false)}
            className={`flex flex-col items-center justify-center min-w-[60px] h-12 rounded-xl transition-all duration-200 active:scale-95 ${
              isActive('/dashboard/kitchen') ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 active:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">soup_kitchen</span>
            <span className="text-[10px] font-bold mt-0.5 leading-none">Kitchen</span>
          </Link>
          <button 
            aria-label="More menu"
            aria-expanded={isDrawerOpen}
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            className={`flex flex-col items-center justify-center min-w-[60px] h-12 rounded-xl transition-all duration-200 active:scale-95 ${
              isDrawerOpen ? 'bg-white text-[#0A0E17] shadow-lg' : 'text-slate-400 active:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">{isDrawerOpen ? 'close' : 'menu'}</span>
            <span className="text-[10px] font-bold mt-0.5 leading-none">{isDrawerOpen ? 'Close' : 'More'}</span>
          </button>
        </nav>
      </div>
    </>
  );
}

import React from 'react';
import Link from 'next/link';

import { signOutAction } from '@/app/login/actions';
import { QueueService } from '@/lib/services/queue-service';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import MobileNavigation from '@/components/dashboard/MobileNavigation';
import DesktopNavigation from '@/components/dashboard/DesktopNavigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DashboardRealtime } from '@/components/realtime/DashboardRealtime';

export default async function RestaurantDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { restaurant } = await RestaurantAdminService.getRestaurantForLayout();
  const activeQueue = await QueueService.getActiveQueue(restaurant.id);
  const activeQueueCount = activeQueue.length;
  
  let avgWaitTime = 0;
  if (activeQueue.length > 0) {
    const totalWait = activeQueue.reduce((acc, q) => {
      const diffMs = new Date().getTime() - new Date(q.joined_at).getTime();
      return acc + Math.max(0, Math.floor(diffMs / 60000));
    }, 0);
    avgWaitTime = Math.floor(totalWait / activeQueue.length);
  }

  return (
    <>
      <DesktopNavigation activeQueueCount={activeQueueCount}>
        <form action={signOutAction} className="w-full mt-2">
          <button title="Sign Out" type="submit" className="w-full py-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors flex items-center justify-center gap-2 text-xs font-bold">
            <span className="material-symbols-outlined text-[14px]">logout</span> Sign Out
          </button>
        </form>
      </DesktopNavigation>

      <div className="pl-0 md:pl-64 flex flex-col min-h-[100dvh] bg-[#0A0E17] pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="fixed top-0 left-0 md:left-64 right-0 h-14 sm:h-16 bg-[#0A0E17]/90 backdrop-blur-xl border-b border-white/[0.06] z-40 text-slate-300 safe-pt">
          <div className="h-14 sm:h-16 w-full px-3 sm:px-4 md:px-6 lg:px-8 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <DashboardRealtime restaurantId={restaurant.id} />
              
              {/* Restaurant Pill - truncated smartly */}
              <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/[0.06] text-sm min-w-0 flex-1 max-w-[180px] sm:max-w-none">
                <span className="material-symbols-outlined text-[16px] text-slate-400 shrink-0 hidden sm:inline">storefront</span>
                <span className="font-semibold text-white truncate text-[13px] sm:text-sm">{restaurant.name}</span>
                <span className="text-slate-500 hidden lg:inline shrink-0 text-xs">/</span>
                <span className="text-slate-400 hidden lg:inline shrink-0 text-xs truncate">Host Station 1</span>
              </div>

              {/* Mobile queue count inline */}
              <span className="lg:hidden shrink-0 hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] font-mono font-bold text-slate-300">
                <span className="material-symbols-outlined text-[14px] text-primary">groups</span>
                {activeQueueCount}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden 2xl:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-primary">groups</span>
                  <span className="text-sm text-white font-bold">{activeQueueCount}</span>
                  <span className="text-[11px] text-slate-400">({activeQueue.reduce((a,b)=>a+b.party_size,0)} guests)</span>
                </div>
                <span className="w-px h-3 bg-white/10"></span>
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-emerald-400">schedule</span>
                  <span className="text-[11px] text-slate-400">Avg:</span>
                  <span className="text-sm text-emerald-400 font-mono font-bold">~{avgWaitTime}m</span>
                </div>
              </div>

              <Link href="/dashboard/queue" className="shrink-0">
                <button className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 h-9 sm:h-9 rounded-xl bg-primary hover:bg-blue-500 active:bg-blue-600 text-white text-[13px] sm:text-sm font-bold shadow-[0_0_15px_rgba(37,99,235,0.35)] transition-all active:scale-95 border border-blue-400/30">
                  <span className="material-symbols-outlined text-[18px]">campaign</span>
                  <span className="hidden sm:inline">Call Next</span>
                  <span className="sm:hidden">Call</span>
                </button>
              </Link>
              
              <ThemeToggle />
              <button aria-label="Notifications" className="w-9 h-9 shrink-0 rounded-xl bg-white/[0.06] border border-white/[0.06] flex items-center justify-center text-slate-400 hover:text-white active:bg-white/10 transition-colors relative">
                <span className="material-symbols-outlined text-[18px]">notifications</span>
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 border-2 border-[#0A0E17]"></span>
              </button>
            </div>
          </div>
        </header>

        <main className="w-full pt-14 sm:pt-16 flex-1 relative min-w-0 overflow-x-hidden">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <MobileNavigation activeQueueCount={activeQueueCount} />
      </div>
    </>
  );
}

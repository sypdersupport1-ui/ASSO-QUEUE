import React from 'react';
import Link from 'next/link';
import { DashboardClient } from '@/components/dashboard/DashboardClient';
import { ShiftFootfallWidget } from '@/components/dashboard/ShiftFootfallWidget';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { QueueService } from '@/lib/services/queue-service';
import { TableService } from '@/lib/services/table-service';
import { OrderService } from '@/lib/services/order-service';
import { AnalyticsService } from '@/lib/services/analytics-service';

export const dynamic = 'force-dynamic';

function getWaitTimeMins(joinedAt: string) {
  const diffMs = new Date().getTime() - new Date(joinedAt).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

export default async function RestaurantAdminDashboardPage() {
  const { userId, restaurantId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
  const { restaurant } = await RestaurantAdminService.getRestaurantDashboardStats();

  // Fetch real data concurrently
  const [activeQueue, tablesRes, activeOrders, shiftFootfallReport] = await Promise.all([
    QueueService.getActiveQueue(restaurantId),
    TableService.listTables({ restaurantId }),
    OrderService.listDashboardOrders(restaurantId, 'ALL'),
    AnalyticsService.getFootfallIn5to5Slots(restaurantId, restaurant.timezone || 'UTC').catch(() => null),
  ]);

  // --- KPI 1: Active Queue ---
  const activeQueueCount = activeQueue.length;
  const activeQueueGuests = activeQueue.reduce((acc, q) => acc + q.party_size, 0);
  
  let avgWaitTime = 0;
  if (activeQueue.length > 0) {
    const totalWait = activeQueue.reduce((acc, q) => acc + getWaitTimeMins(q.joined_at), 0);
    avgWaitTime = Math.floor(totalWait / activeQueue.length);
  }

  const calledCount = activeQueue.filter(q => q.status === 'CALLED').length;

  // --- KPI 2: Floor Occupancy ---
  const tablesTotal = tablesRes.stats.total;
  const tablesReady = tablesRes.stats.available;
  const tablesOccupied = tablesRes.stats.occupied;
  const occupancyPercent = tablesTotal > 0 ? Math.round((tablesOccupied / tablesTotal) * 100) : 0;

  // --- KPI 3: Guests Seated ---
  const guestsSeated = tablesRes.tables.filter(t => t.status === 'OCCUPIED').reduce((acc, t) => acc + t.capacity, 0);
  const partiesSeated = tablesOccupied;
  const tableCapacityMax = tablesRes.tables.reduce((acc, t) => acc + t.capacity, 0);

  // --- KPI 4: Pre-Order Inflow ---
  const preOrders = activeOrders.filter(o => o.status !== 'SERVED' && o.status !== 'CANCELLED');
  const preOrderRevenue = preOrders.reduce((acc, o) => acc + o.total, 0);
  const ticketAvg = preOrders.length > 0 ? Math.round(preOrderRevenue / preOrders.length) : 0;
  const currencySymbol = restaurant.currency === 'INR' ? '₹' : (restaurant.currency === 'USD' ? '$' : '₹');

  // --- Live Queue Feed Data ---
  const feedEntries = activeQueue.slice(0, 5); // Show top 5

  // --- Greeting ---
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';

  return (
    <div className="flex flex-col w-full text-slate-300 font-sans p-4 sm:p-6 md:p-8 gap-5 sm:gap-6 md:gap-8">
      
      {/* Top Section: Greeting and Quick Action */}
      <section className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-4 sm:gap-6 relative z-10">
        <div className="flex flex-col gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <span className="text-primary border border-primary/20 bg-primary/10 px-2 py-1 rounded-full text-[10px]">Shift Telemetry</span>
            <span className="text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Normal Service
            </span>
          </div>
          <div className="relative w-full">
            <h1 className="text-[22px] sm:text-3xl lg:text-4xl leading-tight sm:leading-none font-black text-white tracking-tight sm:tracking-widest uppercase font-headline-xl break-words">
              {greeting}, {restaurant.name}
            </h1>
          </div>
          <p className="text-slate-400 text-[13px] sm:text-sm font-medium leading-relaxed">
            Here is your live floor and queue performance for today&apos;s service.
          </p>
        </div>
        
        {/* Quick Action Block */}
        <div className="flex items-center gap-3 w-full lg:w-auto shrink-0">
          <div className="flex-1 lg:flex-none flex items-center justify-between sm:justify-end gap-3">
            <span className="text-3xl hidden sm:inline select-none">👋</span>
            <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 rounded-xl bg-[#111827] border border-white/5 text-slate-300">
              <span className="material-symbols-outlined text-[16px] text-emerald-400">bolt</span>
              <div className="flex flex-col leading-none">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">TURNOVER:</span>
                <span className="text-sm font-bold text-white">~{restaurant.avg_service_time_mins || 15}m</span>
              </div>
            </div>
            <Link 
              href="/dashboard/queue" 
              className="shrink-0 flex items-center justify-center gap-1.5 px-5 h-11 rounded-xl bg-primary hover:bg-blue-500 active:bg-blue-600 transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)] border border-blue-400/30 text-white font-bold text-sm active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              <span>Add Walk-In</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 4 Command OS KPI Cards - scrollable on very small, grid on larger */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 md:gap-6 relative z-10">
        
        {/* KPI 1: Active Queue */}
        <div className="bg-[#111827] p-5 rounded-2xl border border-white/5 flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border border-primary/20 flex items-center justify-center text-primary bg-primary/5">
                <span className="material-symbols-outlined text-[16px]">groups</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Active</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Queue</span>
              </div>
            </div>
            <div className="px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold">
              {calledCount} Called
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-black text-white font-headline-xl">{activeQueueCount}</span>
            <span className="text-sm font-bold text-white">Groups</span>
            <span className="text-[11px] text-slate-500">({activeQueueGuests} Guests)</span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 border-t border-white/5 pt-3">
            <span>Avg Wait Time:</span>
            <span className="text-white font-mono font-bold">{avgWaitTime} mins</span>
          </div>
        </div>

        {/* KPI 2: Floor Occupancy */}
        <div className="bg-[#111827] p-5 rounded-2xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)] flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-bl-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border border-emerald-500/20 flex items-center justify-center text-emerald-400 bg-emerald-500/5">
                <span className="material-symbols-outlined text-[16px]">grid_view</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Floor</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Occupancy</span>
              </div>
            </div>
            <div className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
              {tablesReady} Tables Ready
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-black text-emerald-400 font-headline-xl">{occupancyPercent}%</span>
            <div className="flex flex-col text-[11px] text-slate-400 leading-tight ml-1">
              <span>{tablesOccupied} of {tablesTotal} Tables</span>
              <span>Full</span>
            </div>
          </div>
          <div className="w-full bg-[#1A2333] h-1.5 rounded-full mt-2 mb-1">
             <div className="bg-emerald-400 h-full rounded-full transition-all duration-500" style={{ width: `${occupancyPercent}%` }}></div>
          </div>
        </div>

        {/* KPI 3: Guests Seated */}
        <div className="bg-[#111827] p-5 rounded-2xl border border-white/5 flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-bl-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border border-purple-500/20 flex items-center justify-center text-purple-400 bg-purple-500/5">
                <span className="material-symbols-outlined text-[16px]">monetization_on</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Guests</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Seated</span>
              </div>
            </div>
            <div className="px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 text-[10px] font-bold">
              Est. Active
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-black text-white font-headline-xl">{guestsSeated}</span>
            <span className="text-sm font-bold text-white">Guests</span>
            <span className="text-[11px] text-slate-500">({partiesSeated} Parties)</span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 border-t border-white/5 pt-3">
            <span>Table Capacity:</span>
            <span className="text-white font-mono font-bold">{tableCapacityMax} Max</span>
          </div>
        </div>

        {/* KPI 4: Pre-Order Inflow */}
        <div className="bg-[#111827] p-5 rounded-2xl border border-amber-500/20 flex flex-col justify-between shadow-[0_0_15px_rgba(245,158,11,0.05)] relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-bl-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border border-amber-500/20 flex items-center justify-center text-amber-500 bg-amber-500/5">
                <span className="material-symbols-outlined text-[16px]">lock</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Pre-Order</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">Inflow</span>
              </div>
            </div>
            <div className="px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 text-[10px] font-bold">
              {preOrders.length} Orders
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-3xl font-black text-amber-500 font-headline-xl tracking-tight">{currencySymbol}{preOrderRevenue.toLocaleString('en-IN')}</span>
            <span className="text-[11px] text-slate-400">active value</span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 border-t border-white/5 pt-3">
            <span>Ticket Avg:</span>
            <span className="text-white font-mono font-bold">{currencySymbol}{ticketAvg.toLocaleString('en-IN')} / order</span>
          </div>
        </div>
      </section>

      {/* 5 AM → 5 AM Shift Footfall Telemetry Widget */}
      {shiftFootfallReport && (
        <ShiftFootfallWidget report={shiftFootfallReport} />
      )}

      {/* Main Split Content */}
      <DashboardClient 
        feedEntries={feedEntries}
        tablesRes={tablesRes}
        activeQueueCount={activeQueueCount}
        userId={userId}
        callTimeoutMinutes={restaurant.call_timeout_minutes || 15}
      />
    </div>
  );
}

import React from 'react';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { QueueService } from '@/lib/services/queue-service';
import { TableService } from '@/lib/services/table-service';
import { OrderService } from '@/lib/services/order-service';

function getWaitTimeMins(joinedAt: string) {
  const diffMs = new Date().getTime() - new Date(joinedAt).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

import {
  updateQueueStatusAction,
  toggleQueueOpenAction,
  setQueueOperatingStateFormAction,
  updateQueueSettingsFormAction,
  updateETASettingsFormAction,
  updateQueueScheduleFormAction,
} from '@/app/dashboard/actions';
import { AddQueueGuestModal } from '@/components/dashboard/AddQueueGuestModal';
import { LiveQueueFeedClient } from '@/components/dashboard/LiveQueueFeedClient';
import { QueueOperationsAccordion } from '@/components/dashboard/QueueOperationsAccordion';
import { ConfirmSubmitButton } from '@/components/dashboard/ConfirmSubmitButton';
import { logger } from '@/lib/logging/logger';
import Link from 'next/link';

export default async function QueueManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; updated?: string; toggled?: string; settingsUpdated?: string; etaUpdated?: string }>;
}) {
  const params = await searchParams;
  const statusFilter = params.status || 'ACTIVE';
  const searchTerm = params.search || '';

  const { userId, restaurantId } = await RestaurantAdminService.getAuthorizedRestaurantContext();
  const supabase = createAdminClient();
  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();

  if (!restaurant) {
    return <div className="p-space-xl text-error">No managed restaurant assigned.</div>;
  }

  // Parallelize independent fetches for snappy load.
  const [entriesRaw, activeEntriesRaw, tablesRes, scheduleInfo, dashboardOrders, menuItemsRes] = await Promise.all([
    QueueService.getAllQueueEntries(restaurant.id, statusFilter, searchTerm).catch((err) => {
      logger.warn('Queue page: entries fetch failed, degrading to empty', {
        operation: 'dashboard_queue_page',
        metadata: { section: 'entries', error: err instanceof Error ? err.message : String(err) },
      });
      return [];
    }),
    QueueService.getActiveQueue(restaurant.id).catch((err) => {
      logger.warn('Queue page: active queue fetch failed, degrading to empty', {
        operation: 'dashboard_queue_page',
        metadata: { section: 'activeEntries', error: err instanceof Error ? err.message : String(err) },
      });
      return [];
    }),
    TableService.listTables({ restaurantId: restaurant.id }).catch((err) => {
      logger.warn('Queue page: tables fetch failed, degrading to empty', {
        operation: 'dashboard_queue_page',
        metadata: { section: 'tables', error: err instanceof Error ? err.message : String(err) },
      });
      return TableService.emptyTablesResult();
    }),
    (async () => {
      try {
        const { QueueScheduleService } = await import('@/lib/services/queue-schedule-service');
        const schedule = await QueueScheduleService.getSchedule(restaurant.id, userId);
        const availability = await QueueScheduleService.evaluateAvailability(restaurant.id);
        return { schedule, availability };
      } catch { return null; }
    })(),
    OrderService.listDashboardOrders(restaurant.id, 'ALL').catch(() => []),
    (async () => {
      try {
        return await supabase
          .from('menu_items')
          .select('id, name, price, description, available, active, menu_categories(name)')
          .eq('restaurant_id', restaurant.id)
          .eq('is_archived', false);
      } catch {
        return { data: [] };
      }
    })(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = entriesRaw as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeEntries = activeEntriesRaw as any[];

  // Queue health aggregation
  let queueHealth: Awaited<ReturnType<typeof QueueService.getQueueHealth>>;
  try {
    queueHealth = await QueueService.getQueueHealth(restaurant.id, userId);
  } catch {
    queueHealth = QueueService.buildFallbackQueueHealth({
      restaurant,
      activeEntries,
      tables: tablesRes.tables,
    });
  }

  const dineInActive = activeEntries.filter((e) => e.queue_type !== 'TAKEAWAY');
  const takeawayActive = activeEntries.filter((e) => e.queue_type === 'TAKEAWAY');
  const dineInWaiting = dineInActive.filter((e) => e.status === 'WAITING').length;
  const dineInCalled = dineInActive.filter((e) => e.status === 'CALLED' || e.status === 'NOTIFIED').length;
  const takeawayWaiting = takeawayActive.filter((e) => e.status === 'WAITING').length;
  const takeawayCalled = takeawayActive.filter((e) => e.status === 'CALLED' || e.status === 'NOTIFIED').length;

  const waitingEntries = activeEntries.filter((e) => e.status === 'WAITING');
  const calledEntries = activeEntries.filter((e) => e.status === 'CALLED' || e.status === 'NOTIFIED');
  const waitingCount = waitingEntries.length;
  const calledCount = calledEntries.length;
  const totalGuests = activeEntries.reduce((sum, e) => sum + e.party_size, 0);
  const queueEnabled = restaurant.queue_enabled ?? true;
  const operatingState = (restaurant as unknown as { queue_operating_state: string }).queue_operating_state || 'OPEN';

  // Format menuItems for StaffTakeawayOrderModal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMenuItems = (menuItemsRes?.data || []) as any[];
  const formattedMenuItems = rawMenuItems.map((mi) => ({
    id: mi.id,
    name: mi.name,
    price: Number(mi.price),
    description: mi.description,
    available: mi.available,
    active: mi.active,
    categoryName: mi.menu_categories?.name || null,
  }));

  // Best next guest logic (first waiting)
  const nextUp = waitingEntries.length > 0 ? waitingEntries[0] : null;

  const tablesTotal = tablesRes.stats.total;
  const tablesReady = tablesRes.stats.available;
  const tablesOccupied = tablesRes.stats.occupied;
  const tablesCleaning = tablesRes.tables.filter((t) => t.status === 'CLEANING').length;
  const tablesReserved = tablesRes.tables.filter((t) => t.status === 'RESERVED').length;

  const occupiedPct = tablesTotal > 0 ? (tablesOccupied / tablesTotal) * 100 : 0;
  const cleaningPct = tablesTotal > 0 ? (tablesCleaning / tablesTotal) * 100 : 0;
  const reservedPct = tablesTotal > 0 ? (tablesReserved / tablesTotal) * 100 : 0;
  const readyPct = tablesTotal > 0 ? (tablesReady / tablesTotal) * 100 : 0;

  let avgWaitTime = 0;
  if (activeEntries.length > 0) {
    const totalWait = activeEntries.reduce((acc, q) => acc + getWaitTimeMins(q.joined_at), 0);
    avgWaitTime = Math.floor(totalWait / activeEntries.length);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEntries = entries.filter((e) => new Date(e.created_at) >= todayStart);
  const seatedToday = todayEntries.filter((e) => e.status === 'SEATED').length;
  const guestsSeatedToday = todayEntries
    .filter((e) => e.status === 'SEATED')
    .reduce((s, e) => s + ((e as unknown as { actual_guests?: number }).actual_guests ?? e.party_size ?? 0), 0);

  let bestMatchTable = null;
  if (nextUp) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = tablesRes.tables.filter((t: any) => t.status === 'AVAILABLE' && t.capacity >= nextUp.party_size);
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.capacity - b.capacity);
      bestMatchTable = candidates[0];
    }
  }

  return (
    <div className="flex flex-col w-full px-3 sm:px-6 md:px-space-xl py-3 sm:py-space-md gap-3 sm:gap-4 bg-[#070B14] min-h-screen text-white antialiased relative z-10">
      
      {/* COMPACT MISSION-CONTROL COMMAND BAR (Combines Title, Intake Pills, Health Chip, and Hero Actions) */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-[#0E1524] border border-white/10 shadow-lg">
        {/* Title & Live Headcount Beacon */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-black">
              <span className="material-symbols-outlined text-[20px]">queue</span>
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-none">
                  Live Queue
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                    queueEnabled
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      queueEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                    }`}
                  />
                  {queueEnabled ? `${activeEntries.length} Active • ${totalGuests} Guests` : 'Closed'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Health & Schedule Badges right in the header bar */}
          <div className="hidden sm:flex items-center gap-2">
            {scheduleInfo && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                  scheduleInfo.availability.scheduledOpen
                    ? 'bg-white/5 border-white/10 text-slate-300'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                }`}
                title="Restaurant operating schedule status"
              >
                <span className="material-symbols-outlined text-[13px] text-blue-400">schedule</span>
                <span>{scheduleInfo.availability.localTimeStr}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    scheduleInfo.availability.scheduledOpen ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
              </span>
            )}

            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase border ${
                queueHealth.health === 'HEALTHY'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : queueHealth.health === 'BUSY'
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  queueHealth.health === 'HEALTHY'
                    ? 'bg-emerald-400'
                    : queueHealth.health === 'BUSY'
                    ? 'bg-amber-400'
                    : 'bg-rose-400 animate-ping'
                }`}
              />
              {queueHealth.health}
            </span>
          </div>
        </div>

        {/* Center: Sleek Segmented Intake Mode Switcher (Takes 0 extra height!) */}
        <div className="flex items-center gap-2 self-start xl:self-auto overflow-x-auto hide-scrollbar max-w-full">
          <div className="inline-flex items-center p-1 rounded-xl bg-[#080D18] border border-white/10 shadow-inner">
            {(['OPEN', 'PAUSED', 'CLOSING_SOON', 'CLOSED'] as const).map((state) => (
              <form key={state} action={setQueueOperatingStateFormAction} className="inline">
                <input type="hidden" name="restaurantId" value={restaurant.id} />
                <input type="hidden" name="newState" value={state} />
                <input type="hidden" name="actorUserId" value={userId} />
                <ConfirmSubmitButton
                  idleLabel={state === 'CLOSING_SOON' ? 'CLOSING' : state}
                  armedLabel="Confirm?"
                  className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-black tracking-wider uppercase transition-all cursor-pointer ${
                    operatingState === state
                      ? state === 'OPEN'
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                        : state === 'PAUSED'
                        ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30'
                        : state === 'CLOSING_SOON'
                        ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                        : 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                />
              </form>
            ))}
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {nextUp && (
              <form action={updateQueueStatusAction.bind(null, nextUp.id, 'NOTIFIED', userId)}>
                <button
                  type="submit"
                  id="call-next-hero-btn"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-95 text-white font-black text-xs shadow-lg shadow-blue-500/30 transition-all flex items-center gap-1.5 cursor-pointer border border-blue-400/30"
                >
                  <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                  <span>Call {nextUp.display_number || nextUp.queue_number}</span>
                </button>
              </form>
            )}

            <AddQueueGuestModal
              label="Add Guest"
              icon="person_add"
              triggerClassName="px-3.5 py-2 rounded-xl bg-[#131D31] hover:bg-[#1A2742] active:scale-95 text-white text-xs font-bold transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
            />

            <form action={toggleQueueOpenAction.bind(null, restaurant.id, !queueEnabled, userId)}>
              <ConfirmSubmitButton
                idleLabel={
                  <span className="material-symbols-outlined text-[18px]">
                    {queueEnabled ? 'pause' : 'play_arrow'}
                  </span>
                }
                armedLabel={<span className="font-bold">Sure?</span>}
                className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center ${
                  queueEnabled
                    ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                    : 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                }`}
              />
            </form>
          </div>
        </div>
      </div>

      {/* STREAMLINED COCKPIT KPI RIBBON (Compact ~74px height prevents pushing queue off screen) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        {/* Metric 1: Waiting */}
        <div className="bg-[#0E1524] rounded-2xl border border-white/10 p-3 sm:p-3.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-blue-500/30 transition-colors">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              Waiting
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-2xl font-black text-white">{waitingCount}</span>
              <span className="text-[11px] text-slate-400 font-semibold">parties</span>
            </div>
            <span className="text-[10px] text-blue-300 truncate font-medium">
              {dineInWaiting} dine-in · {takeawayWaiting} takeaway
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">groups</span>
          </div>
        </div>

        {/* Metric 2: Called */}
        <div className="bg-[#0E1524] rounded-2xl border border-white/10 p-3 sm:p-3.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-indigo-500/30 transition-colors">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              Called
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-2xl font-black text-white">{calledCount}</span>
              <span className="text-[11px] text-slate-400 font-semibold">paged</span>
            </div>
            <span className="text-[10px] text-indigo-300 truncate font-medium">
              {dineInCalled} dine-in · {takeawayCalled} takeaway
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">contactless</span>
          </div>
        </div>

        {/* Metric 3: Avg Wait */}
        <div className="bg-[#0E1524] rounded-2xl border border-white/10 p-3 sm:p-3.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-amber-500/30 transition-colors">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              Avg Wait
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-2xl font-black text-amber-300">~{avgWaitTime}m</span>
            </div>
            <span className="text-[10px] text-emerald-400 truncate font-bold">
              Oldest: {queueHealth.oldestWaitingAgeMins !== null ? `${queueHealth.oldestWaitingAgeMins}m` : '0m'}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">timer</span>
          </div>
        </div>

        {/* Metric 4: Seated Today */}
        <div className="bg-[#0E1524] rounded-2xl border border-white/10 p-3 sm:p-3.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Served Today
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-2xl font-black text-emerald-400">{seatedToday}</span>
              <span className="text-[11px] text-slate-400 font-semibold">parties</span>
            </div>
            <span className="text-[10px] text-emerald-300 truncate font-medium">
              {guestsSeatedToday} total guests
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
          </div>
        </div>

        {/* Metric 5: Floor Utilization */}
        <div className="col-span-2 sm:col-span-1 bg-[#0E1524] rounded-2xl border border-white/10 p-3 sm:p-3.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-teal-500/30 transition-colors">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
              Tables
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-2xl font-black text-white">{tablesReady}</span>
              <span className="text-[11px] text-slate-400 font-semibold">/ {tablesTotal} ready</span>
            </div>
            <span className="text-[10px] text-teal-300 truncate font-medium">
              {Math.round(occupiedPct)}% floor occupied
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">event_seat</span>
          </div>
        </div>
      </div>

      {/* MAIN WORKSTATION (Left: Live Queue Stream, Right: Host Cockpit & Smart Dispatch) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-5 items-start">
        
        {/* LEFT COLUMN: LIVE QUEUE STREAM (8 Columns - Immediately visible above the fold!) */}
        <div className="xl:col-span-8 flex flex-col gap-4">
          <LiveQueueFeedClient
            initialEntries={entries}
            tablesRes={tablesRes}
            userId={userId}
            restaurantId={restaurant.id}
            callTimeoutMinutes={restaurant.call_timeout_minutes || 15}
            initialStatusFilter={statusFilter}
            initialSearchTerm={searchTerm}
            initialOrders={dashboardOrders}
            menuItems={formattedMenuItems}
            currencySymbol={restaurant.currency === 'INR' ? '₹' : (restaurant.currency === 'USD' ? '$' : '₹')}
            takeawayManualOrderingEnabled={Boolean(restaurant.takeaway_manual_ordering_enabled)}
          />
        </div>

        {/* RIGHT COLUMN: STICKY HOST COCKPIT & DISPATCH (4 Columns) */}
        <div className="xl:col-span-4 flex flex-col gap-4 sticky top-4">
          
          {/* Card 1: Smart Dispatch / Next Up Assist */}
          <div className="rounded-2xl bg-[#0E1524] border border-white/10 p-5 shadow-lg flex flex-col gap-3.5 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center text-xs">
                  <span className="material-symbols-outlined text-[17px]">smart_toy</span>
                </span>
                <h3 className="text-sm font-black text-white tracking-wide uppercase">
                  Smart Dispatch
                </h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-wider">
                Auto-Optimized
              </span>
            </div>

            {nextUp ? (
              <div className="flex flex-col gap-3">
                {/* Guest Pill */}
                <div className="p-3.5 rounded-xl bg-[#080D18] border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-mono font-black text-base shadow-md shrink-0">
                      {(nextUp.display_number || nextUp.queue_number || '').toString().replace(/^#+/, '')}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-black text-white text-sm truncate">
                        {nextUp.customer_name}
                      </span>
                      <span className="text-xs text-slate-400">
                        👥 {nextUp.party_size} {nextUp.party_size === 1 ? 'Guest' : 'Guests'} • Waiting {getWaitTimeMins(nextUp.joined_at)}m
                      </span>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-emerald-400 text-[22px] shrink-0">
                    check_circle
                  </span>
                </div>

                {/* Best Table Match */}
                {bestMatchTable ? (
                  <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/40 via-[#0B1A24] to-[#080D18] border border-emerald-500/30 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-300 font-mono font-black text-xs flex items-center justify-center border border-emerald-500/40">
                        T{bestMatchTable.tableNumber.replace(/^T/, '')}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-emerald-300">
                          Table {bestMatchTable.tableNumber}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {bestMatchTable.capacity} Seats • {bestMatchTable.zoneName || 'Ready'}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-black text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                      Perfect Fit
                    </span>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-[#080D18] text-slate-400 text-xs border border-white/5 text-center">
                    No open table matches party size ({nextUp.party_size}) yet.
                  </div>
                )}

                {/* Direct Action Button */}
                <form action={updateQueueStatusAction.bind(null, nextUp.id, 'NOTIFIED', userId)}>
                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-95 text-white font-black text-xs shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer border border-blue-400/30"
                  >
                    <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                    <span>Notify Next — Table Almost Ready</span>
                  </button>
                </form>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#080D18] text-center border border-white/5 flex flex-col items-center justify-center gap-1">
                <span className="material-symbols-outlined text-slate-600 text-[28px]">done_all</span>
                <span className="text-xs font-bold text-slate-300">Host Station Caught Up</span>
                <span className="text-[10px] text-slate-500">No guests waiting in line.</span>
              </div>
            )}
          </div>

          {/* Card 2: Floor Saturation & Table Quick Board */}
          <div className="rounded-2xl bg-[#0E1524] border border-white/10 p-5 shadow-lg flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-white tracking-wide uppercase">
                Floor Saturation
              </span>
              <span className="text-xs font-black text-blue-400">{Math.round(occupiedPct)}% Occupied</span>
            </div>

            {/* Segmented Color Bar */}
            <div className="w-full h-3 bg-[#080D18] rounded-full overflow-hidden flex border border-white/5">
              <div
                className="bg-amber-500 h-full transition-all"
                style={{ width: `${occupiedPct}%` }}
                title={`Occupied: ${tablesOccupied}`}
              />
              <div
                className="bg-rose-500 h-full transition-all"
                style={{ width: `${cleaningPct}%` }}
                title={`Cleaning: ${tablesCleaning}`}
              />
              <div
                className="bg-blue-500 h-full transition-all"
                style={{ width: `${reservedPct}%` }}
                title={`Reserved: ${tablesReserved}`}
              />
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: `${readyPct}%` }}
                title={`Open: ${tablesReady}`}
              />
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-slate-300 font-semibold">{tablesReady} Ready to Seat</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-slate-300 font-semibold">{tablesOccupied} Occupied</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                <span className="text-slate-300 font-semibold">{tablesCleaning} Needs Clean</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <span className="text-slate-300 font-semibold">{tablesReserved} Reserved</span>
              </div>
            </div>

            {/* Quick Link to Floor Blueprint */}
            <Link
              href="/dashboard/tables"
              className="mt-1 py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-bold transition-all flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-blue-400">table_bar</span>
                <span>Open Floor Blueprint &amp; Seating Map</span>
              </span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>

          {/* Card 3: Operations & Admin Accordion (Collapsible, keeps bottom clean!) */}
          <QueueOperationsAccordion
            scheduleInfo={scheduleInfo}
            updateQueueScheduleFormAction={updateQueueScheduleFormAction}
            timezone={(restaurant as unknown as { timezone?: string }).timezone || 'Asia/Kolkata'}
            queueHealth={queueHealth}
            maxQueueCapacity={restaurant.max_queue_capacity || 100}
            callTimeoutMinutes={restaurant.call_timeout_minutes || 15}
            restaurant={restaurant}
            userId={userId}
            updateQueueSettingsFormAction={updateQueueSettingsFormAction}
            updateETASettingsFormAction={updateETASettingsFormAction}
          />

        </div>
      </div>

      {/* Keyboard Shortcut Listener Script */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
        document.addEventListener('keydown', (e) => {
          if ((e.code === 'Space' || e.code === 'Enter') && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            const heroBtn = document.getElementById('call-next-hero-btn');
            if (heroBtn) {
              e.preventDefault();
              heroBtn.click();
              heroBtn.classList.add('scale-95', 'ring-4', 'ring-primary/20');
              setTimeout(() => heroBtn.classList.remove('scale-95', 'ring-4', 'ring-primary/20'), 150);
            }
          }
        });
      `,
        }}
      />
    </div>
  );
}

'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AddTableModal } from './AddTableModal';
import { updateTableStatusAction, exitSeatedGuestAction } from '@/app/dashboard/actions';
import { chimeEngine } from '@/lib/audio-chime';
import { SeatCustomerModal, SeatableTableItem } from './SeatCustomerModal';
import { ArchitecturalTable } from './ArchitecturalTable';

function formatDiningDuration(seatedAt: string | null | undefined): string {
  if (!seatedAt) return '';
  const diffMs = Date.now() - new Date(seatedAt).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

interface FloorManagerClientProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zones: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats: any;
  restaurantName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queueEntries?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seatedEntries?: any[];
  userId?: string;
  seatingMode?: 'SIMPLE' | 'STRICT';
}

export function FloorManagerClient({
  tables,
  zones,
  stats,
  restaurantName,
  queueEntries = [],
  seatedEntries = [],
  userId = '',
  seatingMode = 'SIMPLE',
}: FloorManagerClientProps) {
  const router = useRouter();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(tables.length > 0 ? tables[0].id : null);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AVAILABLE' | 'OCCUPIED' | 'CLEANING'>('ALL');
  const [isPending, startTransition] = useTransition();

  // Periodic polling sync to keep floor manager strictly synchronized with live queue
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [router]);

  const handleStatusChange = (tableId: string, newStatus: string) => {
    startTransition(async () => {
      try {
        const table = tables.find((t) => t.id === tableId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await updateTableStatusAction(tableId, newStatus as any, table?.status as any);
        if (result && !result.success) {
          alert(result.error || 'Failed to update table status');
        } else {
          router.refresh();
        }
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        alert(err.message || 'Failed to update table status');
      }
    });
  };

  const handleExitCustomer = (entryId: string, tableId: string) => {
    startTransition(async () => {
      try {
        chimeEngine.playSeatChime();
        const result = await exitSeatedGuestAction(entryId, tableId);
        if (result && !result.success) {
          alert(result.error || 'Failed to exit seated customer');
        } else {
          router.refresh();
        }
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        alert(err.message || 'Failed to exit seated customer');
      }
    });
  };

  // Build lookup map for currently seated guest per table.
  // CRITICAL: Only map entries with status 'SEATED'
  const seatedMap = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new Map<string, any[]>();
    (seatedEntries || []).forEach((entry: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (entry.seated_table_id && entry.status === 'SEATED') {
        const existing = map.get(entry.seated_table_id) || [];
        existing.push(entry);
        map.set(entry.seated_table_id, existing);
      }
    });
    return map;
  }, [seatedEntries]);

  const selectedTable = tables.find((t) => t.id === selectedTableId);
  // CRITICAL BUG FIX: Only show seated guest if the table is actually OCCUPIED.
  // Never show a past or orphaned guest on an AVAILABLE or CLEANING table.
  const selectedSeatedGuests =
    selectedTable && selectedTable.status === 'OCCUPIED' ? (seatedMap.get(selectedTable.id) || []) : [];

  // Filter tables by zone and status filter
  const zoneFiltered = activeZone ? tables.filter((t) => t.zoneId === activeZone) : tables;
  const filteredTables = statusFilter === 'ALL' ? zoneFiltered : zoneFiltered.filter((t) => t.status === statusFilter);

  // Group by zone for the blueprint view
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupedTables = filteredTables.reduce<Record<string, any[]>>((acc, table) => {
    const zoneName = table.zoneName || 'Unassigned';
    if (!acc[zoneName]) acc[zoneName] = [];
    acc[zoneName].push(table);
    return acc;
  }, {} as Record<string, typeof tables>);

  // Compute stats
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleaningCount = tables.filter((t: any) => t.status === 'CLEANING').length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waitingGuests = (queueEntries as any[]).filter((e: any) =>
    ['WAITING', 'CALLED', 'NOTIFIED'].includes(e.status)
  );
  const totalFloorSeats = tables.reduce((sum, t) => sum + (t.capacity || 0), 0);

  // Available tables list for SeatCustomerModal
  const availableTablesList = useMemo(() => {
    return tables.filter((t) => t.status === 'AVAILABLE') as unknown as SeatableTableItem[];
  }, [tables]);

  // Recommended next guest in line for selected available table
  const nextMatchingGuest = useMemo(() => {
    if (!selectedTable || selectedTable.status !== 'AVAILABLE') return null;
    return waitingGuests.find((e: { party_size?: number }) => (e.party_size || 1) <= selectedTable.capacity) || null;
  }, [selectedTable, waitingGuests]);

  return (
    <div className="w-full flex-1 flex flex-col h-[calc(100vh-64px)] bg-[#0A0E17] text-white overflow-hidden">
      {/* 1. Command Bar & Quick Stats Ribbon */}
      <div className="p-4 border-b border-white/5 bg-[#0D121F] shrink-0 flex flex-col gap-4 z-20 shadow-md">
        {/* Top Header Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <h2 className="text-lg sm:text-2xl font-black text-white tracking-tight flex items-center gap-1.5 sm:gap-2">
                <span className="material-symbols-outlined text-blue-400 text-[20px] sm:text-[24px]">table_restaurant</span>
                Floor Manager
              </h2>
              <div className="hidden sm:flex items-center gap-1.5 bg-[#111827] border border-white/10 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs text-slate-400 font-bold">{restaurantName} • {totalFloorSeats} Seats</span>
              </div>
              <Link
                href="/dashboard/profile"
                title="Click to change Seating Mode in Venue Settings"
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full border text-[11px] sm:text-xs font-bold transition-all shadow-sm ${
                  seatingMode === 'STRICT'
                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">tune</span>
                <span>{seatingMode === 'STRICT' ? 'Strict Mode (Shared)' : 'Simple Mode (Exclusive)'}</span>
              </Link>
            </div>
            
            {/* Mobile Add Table */}
            <div className="md:hidden shrink-0 ml-2">
              <AddTableModal zones={zones} />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 overflow-x-auto hide-scrollbar pb-1">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest hidden sm:inline">Filter Zone:</span>
              <button
                type="button"
                onClick={() => setActiveZone(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                  activeZone === null
                    ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                All
              </button>
              {zones.map((z: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setActiveZone(z.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                    activeZone === z.id
                      ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {z.name}
                </button>
              ))}
            </div>
            
            <div className="h-6 w-px bg-white/10 hidden md:block mx-1 shrink-0"></div>
            
            {/* Desktop Add Table */}
            <div className="hidden md:block shrink-0">
              <AddTableModal zones={zones} />
            </div>
          </div>
        </div>

        {/* KPI Ribbon (Interactive Quick Filters) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'OCCUPIED' ? 'ALL' : 'OCCUPIED')}
            className={`text-left rounded-xl border p-3 flex items-center gap-4 transition-all cursor-pointer ${
              statusFilter === 'OCCUPIED'
                ? 'bg-amber-500/20 border-amber-500 ring-2 ring-amber-500/40'
                : 'bg-[#151B2B] border-white/5 hover:border-amber-500/30'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <span className="material-symbols-outlined text-[20px]">restaurant</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Active Tables</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-white">{stats.occupied}</span>
                <span className="text-xs text-slate-400 font-bold">/ {stats.total}</span>
              </div>
            </div>
          </button>
          
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'CLEANING' ? 'ALL' : 'CLEANING')}
            className={`text-left rounded-xl border p-3 flex items-center gap-4 transition-all cursor-pointer ${
              statusFilter === 'CLEANING'
                ? 'bg-rose-500/20 border-rose-500 ring-2 ring-rose-500/40'
                : 'bg-[#151B2B] border-white/5 hover:border-rose-500/30'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
              <span className="material-symbols-outlined text-[20px]">cleaning_services</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Needs Clean</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-rose-400">{cleaningCount}</span>
                <span className="text-xs text-slate-400 font-bold">Tables</span>
              </div>
            </div>
          </button>
          
          <div className="bg-[#151B2B] rounded-xl border border-white/5 p-3 flex items-center gap-4 group hover:border-blue-500/30 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <span className="material-symbols-outlined text-[20px]">groups</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Queued Guests</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-white">{waitingGuests.length}</span>
                <span className="text-xs text-slate-400 font-bold">Parties</span>
              </div>
            </div>
          </div>
          
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'AVAILABLE' ? 'ALL' : 'AVAILABLE')}
            className={`text-left rounded-xl border p-3 flex items-center gap-4 transition-all cursor-pointer ${
              statusFilter === 'AVAILABLE'
                ? 'bg-emerald-500/20 border-emerald-500 ring-2 ring-emerald-500/40'
                : 'bg-[#151B2B] border-white/5 hover:border-emerald-500/30'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <span className="material-symbols-outlined text-[20px]">event_seat</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Available</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-white">{availableTablesList.length}</span>
                <span className="text-xs text-slate-400 font-bold">Tables</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Main Content Area (Scrollable body) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left Side: Blueprint Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar relative bg-[#090D16]"
             style={{
               backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
               backgroundSize: '32px 32px',
               backgroundPosition: '-1px -1px'
             }}>
          
          <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-32">
            {/* Architectural Blueprint Filter & Legend Bar */}
            <div className="bg-[#0E1422]/90 border border-white/10 p-3 sm:p-4 rounded-2xl backdrop-blur-xl flex flex-wrap items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 shrink-0 mr-1">
                  <span className="material-symbols-outlined text-[16px] text-blue-400">tune</span>
                  Filter:
                </span>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    statusFilter === 'ALL'
                      ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  All ({tables.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('AVAILABLE')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    statusFilter === 'AVAILABLE'
                      ? 'bg-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                      : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Available ({availableTablesList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('OCCUPIED')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    statusFilter === 'OCCUPIED'
                      ? 'bg-amber-600 text-white shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                      : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  Dining ({stats.occupied})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('CLEANING')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    statusFilter === 'CLEANING'
                      ? 'bg-rose-600 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                      : 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                  Needs Clean ({cleaningCount})
                </button>
              </div>

              {/* Map Legend */}
              <div className="hidden sm:flex items-center gap-4 text-[11px] font-medium text-slate-400 border-t sm:border-t-0 sm:border-l border-white/10 pt-2 sm:pt-0 sm:pl-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]"></div>
                  <span>Diner Seated</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-md border border-emerald-500/50 bg-emerald-500/20"></div>
                  <span>Empty Chair</span>
                </div>
              </div>
            </div>

            {Object.keys(groupedTables).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-center text-slate-500">
                <span className="material-symbols-outlined text-6xl mb-4 text-slate-700/50">grid_view</span>
                <p className="font-bold text-white text-lg">No tables found</p>
                <p className="text-sm text-slate-400 mt-2 max-w-sm">
                  {statusFilter !== 'ALL'
                    ? `There are currently no tables matching "${statusFilter}". Try resetting your filter.`
                    : 'Build your restaurant layout by adding tables.'}
                </p>
                {statusFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ALL')}
                    className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black cursor-pointer shadow-lg shadow-blue-900/30"
                  >
                    Reset Filter
                  </button>
                )}
              </div>
            ) : (
              Object.entries(groupedTables).map(([zoneName, tableList]: [string, any[]], zoneIdx) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={zoneName} className="flex flex-col gap-4 relative z-10">
                  <div className="flex items-center gap-3 border-b border-white/5 pb-2">
                    <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-400 font-mono text-xs font-black border border-blue-500/20">
                      SEC-{String.fromCharCode(65 + zoneIdx)}
                    </span>
                    <span className="text-sm font-black uppercase tracking-widest text-slate-300">
                      {zoneName}
                    </span>
                    <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent"></div>
                    <span className="text-xs text-slate-500 font-bold">{tableList.length} Tables</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                    {tableList.map((table) => {
                      const isOccupied = table.status === 'OCCUPIED';
                      const seatedGuests = isOccupied ? (seatedMap.get(table.id) || []) : [];
                      const tableMatchingGuest = table.status === 'AVAILABLE'
                        ? waitingGuests.find((e: { party_size?: number }) => (e.party_size || 1) <= table.capacity) || null
                        : null;

                      return (
                        <ArchitecturalTable
                          key={table.id}
                          table={table}
                          isSelected={selectedTableId === table.id}
                          seatedGuests={seatedGuests}
                          onSelect={() => setSelectedTableId(table.id)}
                          onStatusChange={handleStatusChange}
                          isPending={isPending}
                          nextMatchingGuest={tableMatchingGuest}
                          availableTablesList={availableTablesList}
                          userId={userId}
                          onSeated={() => {
                            chimeEngine.playSeatChime();
                            router.refresh();
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Smart Table Inspector */}
        {/* Mobile overlay backdrop */}
        <div 
          className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300 ${selectedTable ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setSelectedTableId(null)}
        />
        <div className={`
          fixed lg:static inset-x-0 bottom-0 z-50 lg:z-20
          w-full lg:w-[380px] xl:w-[420px] 
          h-auto max-h-[75vh] lg:h-full lg:max-h-full 
          bg-[#0D121F] lg:border-t-0 lg:border-l border-t border-white/10 rounded-t-3xl lg:rounded-none
          flex flex-col shrink-0 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:shadow-none
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${selectedTable ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
        `}>
          {/* Mobile Handle */}
          <div className="lg:hidden flex items-center justify-center pt-4 pb-2 w-full cursor-pointer" onClick={() => setSelectedTableId(null)}>
            <div className="w-12 h-1.5 rounded-full bg-white/20"></div>
          </div>
          
          {selectedTable ? (
            <div className="flex flex-col p-5 sm:p-6 gap-6 h-full min-h-0 overflow-y-auto custom-scrollbar pb-10 lg:pb-5">
              {/* Header */}
              <div className="flex items-start justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-mono text-xl font-black shadow-lg ${
                    selectedTable.status === 'AVAILABLE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                    selectedTable.status === 'OCCUPIED' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                    selectedTable.status === 'CLEANING' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                    'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {(() => {
                      const rawNum = String(selectedTable.tableNumber || '').trim();
                      const numOnly = rawNum.replace(/^tables?\s*/i, '').trim();
                      return numOnly.toUpperCase().startsWith('T') ? numOnly.toUpperCase() : `T${numOnly}`;
                    })()}
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-lg font-black text-white leading-tight">Table Details</h3>
                    <span className="text-xs text-slate-400 font-bold">{selectedTable.zoneName || 'Main Floor'} • {selectedTable.capacity} Seats</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Context Card */}
              <div className="flex-1 flex flex-col gap-4 overflow-y-auto hide-scrollbar shrink-0">
                {selectedTable.status === 'OCCUPIED' && selectedSeatedGuests.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {selectedSeatedGuests.map((sg: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                      <div key={sg.id} className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-5 flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                          <span className="text-xs font-black uppercase tracking-widest text-amber-400">Current Party</span>
                          <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Q-{(sg.display_number || sg.queue_number || '').toString().replace(/^#+/, '')}
                          </span>
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-xl font-black text-white">{sg.customer_name}</span>
                          <div className="flex items-center gap-3 text-sm text-amber-200 mt-1">
                            <span className="font-bold flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">group</span> {sg.actual_guests || sg.party_size} Guests</span>
                            <span className="opacity-50">•</span>
                            <span className="font-mono font-bold flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">timer</span> {formatDiningDuration(sg.seated_at) || '0m'}</span>
                          </div>
                          {sg.customer_phone && (
                             <span className="text-xs text-slate-400 mt-2 font-mono flex items-center gap-1.5 bg-black/20 p-2 rounded-lg border border-white/5 w-max">
                               <span className="material-symbols-outlined text-[14px]">call</span> {sg.customer_phone}
                             </span>
                          )}
                        </div>

                        <div className="pt-3">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleExitCustomer(sg.id, selectedTable.id)}
                            className="w-full py-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white text-sm font-black shadow-lg shadow-amber-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <span className="material-symbols-outlined">receipt_long</span>
                            Complete &amp; Clear Party
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedTable.status === 'OCCUPIED' && selectedSeatedGuests.length === 0 && (
                  <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                      <span className="text-xs font-black uppercase tracking-widest text-amber-400">Current Party</span>
                      <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Occupied
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-base font-bold text-white">Active Dining Table</span>
                      <p className="text-xs text-slate-400">
                        This table is currently occupied (assigned as part of an active dining party or multi-table combination).
                      </p>
                    </div>
                    <div className="pt-3">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleStatusChange(selectedTable.id, 'CLEANING')}
                        className="w-full py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-sm font-black shadow-lg shadow-rose-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <span className="material-symbols-outlined">cleaning_services</span>
                        Clear Table &amp; Send to Bus
                      </button>
                    </div>
                  </div>
                )}

                {selectedTable.status === 'AVAILABLE' && (
                  <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
                      <span className="text-xs font-black uppercase tracking-widest text-emerald-400">Ready to Seat</span>
                    </div>
                    <p className="text-sm text-emerald-100/70">
                      This table is clean and available for a party of up to <strong className="text-white">{selectedTable.capacity}</strong>.
                    </p>
                    
                    {nextMatchingGuest ? (
                      <div className="bg-black/40 rounded-xl p-4 border border-emerald-500/20 mt-2 shadow-inner relative overflow-hidden group">
                        <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <span className="text-[10px] font-black uppercase text-emerald-400 tracking-widest flex items-center gap-1 mb-2">
                          <span className="material-symbols-outlined text-[14px]">bolt</span> Suggested Match
                        </span>
                        <div className="flex items-center justify-between mb-4">
                           <span className="font-bold text-white text-base">{nextMatchingGuest.customer_name}</span>
                           <span className="text-xs font-bold text-slate-300 bg-white/10 px-2 py-1 rounded">👥 {nextMatchingGuest.party_size}</span>
                        </div>
                        <SeatCustomerModal
                          entryId={nextMatchingGuest.id}
                          customerName={nextMatchingGuest.customer_name}
                          displayNumber={nextMatchingGuest.display_number}
                          partySize={nextMatchingGuest.party_size}
                          userId={userId}
                          seatableTables={availableTablesList}
                          allAvailableTables={availableTablesList}
                          onSeated={() => {
                            chimeEngine.playSeatChime();
                            router.refresh();
                          }}
                        />
                      </div>
                    ) : (
                      <div className="bg-black/30 rounded-xl p-4 border border-white/5 mt-2 text-center text-sm text-slate-400 flex flex-col items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-slate-500 text-2xl">hourglass_empty</span>
                        No pending parties match this capacity.
                      </div>
                    )}
                  </div>
                )}

                {selectedTable.status === 'CLEANING' && (
                  <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
                      <span className="text-xs font-black uppercase tracking-widest text-rose-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span> Needs Sanitization</span>
                    </div>
                    <p className="text-sm text-rose-100/70">
                      Table requires clearing and cleaning before the next party can be seated.
                    </p>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleStatusChange(selectedTable.id, 'AVAILABLE')}
                      className="w-full py-3.5 mt-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-sm font-black shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span className="material-symbols-outlined">check_circle</span>
                      Mark Clean &amp; Ready
                    </button>
                  </div>
                )}
                
                {selectedTable.status === 'RESERVED' && (
                  <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-5 flex flex-col gap-4">
                     <span className="text-xs font-black uppercase tracking-widest text-blue-400 flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">lock</span> Reserved / Held</span>
                     <p className="text-sm text-blue-100/70">This table is manually held for an upcoming party.</p>
                  </div>
                )}
              </div>

              {/* Status Switcher (Bottom docked) */}
              <div className="mt-auto pt-6 border-t border-white/10 flex flex-col gap-3 shrink-0">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Manual Override</span>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleStatusChange(selectedTable.id, 'AVAILABLE')} className={`py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${selectedTable.status === 'AVAILABLE' ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-transparent text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10'}`}>Available</button>
                  <button onClick={() => handleStatusChange(selectedTable.id, 'OCCUPIED')} className={`py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${selectedTable.status === 'OCCUPIED' ? 'bg-amber-500 text-white border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'bg-transparent text-amber-400 border-amber-500/30 hover:bg-amber-500/10'}`}>Occupied</button>
                  <button onClick={() => handleStatusChange(selectedTable.id, 'CLEANING')} className={`py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${selectedTable.status === 'CLEANING' ? 'bg-rose-500 text-white border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]' : 'bg-transparent text-rose-400 border-rose-500/30 hover:bg-rose-500/10'}`}>Bus Table</button>
                  <button onClick={() => handleStatusChange(selectedTable.id, 'RESERVED')} className={`py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${selectedTable.status === 'RESERVED' ? 'bg-blue-500 text-white border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-transparent text-blue-400 border-blue-500/30 hover:bg-blue-500/10'}`}>Reserved</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center gap-4">
              <span className="material-symbols-outlined text-6xl opacity-20">touch_app</span>
              <p className="font-bold text-white text-lg">Select a table</p>
              <p className="text-sm text-slate-400 max-w-[250px]">Click any table on the blueprint to view details and manage seating.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

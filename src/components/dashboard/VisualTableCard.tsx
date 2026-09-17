'use client';

import React, { useOptimistic, useTransition, useState } from 'react';
import { updateTableStatusAction, archiveTableAction } from '@/app/dashboard/actions';
import type { TableStatus } from '@/types/database.types';

const VALID_TABLE_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  AVAILABLE: ['OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'],
  OCCUPIED: ['CLEANING', 'AVAILABLE', 'OUT_OF_SERVICE'],
  CLEANING: ['AVAILABLE', 'OUT_OF_SERVICE'],
  RESERVED: ['OCCUPIED', 'AVAILABLE', 'OUT_OF_SERVICE'],
  OUT_OF_SERVICE: ['AVAILABLE'],
};

interface TableData {
  id: string;
  tableNumber: string;
  capacity: number;
  zoneName: string;
  status: TableStatus;
}

export function VisualTableCard({
  table,
  canManageStatus,
  canDelete,
  canUpdate,
}: {
  table: TableData;
  canManageStatus: boolean;
  canDelete: boolean;
  canUpdate: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Optimistic UI for instant status changes
  const [optimisticStatus, addOptimisticStatus] = useOptimistic(
    table.status,
    (_state, newStatus: TableStatus) => newStatus
  );

  const allowedTransitions = VALID_TABLE_TRANSITIONS[optimisticStatus] || [];

  const handleStatusChange = (newStatus: TableStatus) => {
    setIsMenuOpen(false);
    startTransition(async () => {
      addOptimisticStatus(newStatus);
      await updateTableStatusAction(table.id, newStatus, table.status);
    });
  };

  const handleArchive = () => {
    setIsMenuOpen(false);
    startTransition(async () => {
      await archiveTableAction(table.id);
    });
  };

  // Premium Status-based styling for the table and chairs (Glassmorphism)
  let tableBg = '';
  let tableBorder = '';
  let chairFill = '';
  let chairBorder = '';
  let statusBadge = '';
  let pulseAnimation = '';

  switch (optimisticStatus) {
    case 'AVAILABLE':
      tableBg = 'bg-emerald-500/10 shadow-[0_0_25px_rgba(16,185,129,0.15)] backdrop-blur-md';
      tableBorder = 'border-emerald-500/40';
      chairFill = 'bg-[#0f172a]';
      chairBorder = 'border-emerald-500/60';
      statusBadge = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      break;
    case 'OCCUPIED':
      tableBg = 'bg-blue-600/20 shadow-[0_0_30px_rgba(37,99,235,0.3)] backdrop-blur-md';
      tableBorder = 'border-blue-500/50';
      chairFill = 'bg-blue-400';
      chairBorder = 'border-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]';
      statusBadge = 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      break;
    case 'CLEANING':
      tableBg = 'bg-amber-500/10 shadow-[0_0_20px_rgba(245,158,11,0.15)] backdrop-blur-md';
      tableBorder = 'border-amber-500/50';
      chairFill = 'bg-[#0f172a]';
      chairBorder = 'border-amber-500/50';
      statusBadge = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      pulseAnimation = 'animate-pulse';
      break;
    case 'RESERVED':
      tableBg = 'bg-purple-500/15 shadow-[0_0_25px_rgba(168,85,247,0.2)] backdrop-blur-md';
      tableBorder = 'border-purple-500/40';
      chairFill = 'bg-[#0f172a]';
      chairBorder = 'border-purple-500/50';
      statusBadge = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      break;
    case 'OUT_OF_SERVICE':
    default:
      tableBg = 'bg-slate-800/30 backdrop-blur-md opacity-60';
      tableBorder = 'border-slate-700/50';
      chairFill = 'bg-slate-800';
      chairBorder = 'border-slate-700';
      statusBadge = 'bg-slate-800/50 text-slate-400 border-slate-700/50';
      break;
  }

  // Calculate chair positions (Square Edge Algorithm)
  const capacity = Math.min(Math.max(table.capacity, 1), 20); // Cap visualization to 20
  const chairs: React.ReactNode[] = [];
  const centerX = 64; 
  const centerY = 64; 
  const radius = 52; // Distance from center to edge chairs

  const getPositions = (cap: number, cx: number, cy: number, r: number) => {
    if (cap === 1) return [{x: cx, y: cy - r}];
    if (cap === 2) return [{x: cx - r, y: cy}, {x: cx + r, y: cy}];
    if (cap === 3) return [{x: cx - r, y: cy}, {x: cx + r, y: cy}, {x: cx, y: cy + r}];
    if (cap === 4) return [{x: cx, y: cy - r}, {x: cx + r, y: cy}, {x: cx, y: cy + r}, {x: cx - r, y: cy}];
    
    const topCount = Math.ceil(cap / 4);
    const bottomCount = Math.ceil((cap - topCount) / 3);
    const leftCount = Math.ceil((cap - topCount - bottomCount) / 2);
    const rightCount = cap - topCount - bottomCount - leftCount;

    const distribute = (count: number, x1: number, y1: number, x2: number, y2: number) => {
      if (count === 0) return [];
      if (count === 1) return [{x: (x1+x2)/2, y: (y1+y2)/2}];
      const pts = [];
      for(let i=0; i<count; i++) {
        const t = (i + 0.5) / count;
        pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
      }
      return pts;
    };

    const pts = [];
    pts.push(...distribute(topCount, cx-r, cy-r, cx+r, cy-r));
    pts.push(...distribute(bottomCount, cx-r, cy+r, cx+r, cy+r));
    pts.push(...distribute(leftCount, cx-r, cy-r, cx-r, cy+r));
    pts.push(...distribute(rightCount, cx+r, cy-r, cx+r, cy+r));
    return pts;
  };

  const chairPositions = getPositions(capacity, centerX, centerY, radius);

  chairPositions.forEach((pos, i) => {
    chairs.push(
      <div
        key={i}
        className={`absolute h-4 w-4 rounded-full border-[2.5px] transition-all duration-500 ease-out ${chairFill} ${chairBorder}`}
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          transform: 'translate(-50%, -50%)',
        }}
      />
    );
  });

  return (
    <div
      className={`relative flex flex-col items-center justify-between overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-xl p-6 pt-10 shadow-lg transition-all duration-300 hover:bg-slate-800/50 hover:border-white/20 ${
        isPending ? 'opacity-50 scale-95' : 'scale-100'
      }`}
    >
      {/* Zone & Menu Button at Top */}
      <div className="absolute left-4 top-4 right-4 flex items-center justify-between z-10">
        <span className="truncate rounded-md bg-black/40 px-2 py-1 text-[10px] font-bold text-slate-300 backdrop-blur-md border border-white/5 max-w-[120px] uppercase tracking-wider">
          {table.zoneName || 'Unassigned'}
        </span>

        {/* Triple Dot Menu */}
        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-slate-300 hover:text-white border border-white/5 backdrop-blur-md transition-colors"
          >
            &#8942;
          </button>
          
          {isMenuOpen && (
            <div className="absolute right-0 top-9 w-44 rounded-xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
              {canManageStatus && allowedTransitions.length > 0 && (
                <div className="py-1.5">
                  <div className="px-3 py-1.5 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Set Status</div>
                  {allowedTransitions.map((target) => (
                    <button
                      key={target}
                      onClick={() => handleStatusChange(target)}
                      className="w-full text-left px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition-colors"
                    >
                      &rarr; {target}
                    </button>
                  ))}
                </div>
              )}
              
              {(canDelete || canUpdate) && (
                <div className="border-t border-white/10 py-1.5">
                  <button
                    onClick={handleArchive}
                    className="w-full text-left px-4 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    Archive Table
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Visual Table & Chairs */}
      <div className="relative mt-3 mb-5 h-[128px] w-[128px]">
        {/* The physical square table */}
        <div
          className={`absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border-2 transition-all duration-500 ease-out ${tableBg} ${tableBorder} ${pulseAnimation}`}
        >
          <span className="text-2xl font-black text-white drop-shadow-md z-10 tracking-tight">{table.tableNumber}</span>
        </div>

        {/* The chairs */}
        {chairs}
      </div>

      {/* Status Badge & Capacity */}
      <div className="flex w-full items-center justify-between border-t border-white/10 pt-4 mt-2 z-10">
        <span className={`rounded-lg px-3 py-1.5 text-[10px] font-extrabold border uppercase tracking-wider ${statusBadge} transition-colors duration-500`}>
          {optimisticStatus}
        </span>
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-black/30 px-2 py-1 rounded-md border border-white/5">
          <span>👥</span>
          <span>{table.capacity}</span>
        </div>
      </div>
      
      {/* Click-away overlay when menu is open */}
      {isMenuOpen && (
        <div 
          className="fixed inset-0 z-40"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
    </div>
  );
}

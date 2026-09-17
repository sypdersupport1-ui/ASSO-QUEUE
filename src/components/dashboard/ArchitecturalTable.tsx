'use client';

import React, { useMemo } from 'react';
import { SeatableTableItem } from './SeatCustomerModal';

export interface TableItem {
  id: string;
  tableNumber: string;
  capacity: number;
  shape?: 'ROUND' | 'SQUARE' | 'RECTANGLE' | 'BAR';
  status: 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'RESERVED';
  zoneId?: string | null;
  zoneName?: string | null;
  occupiedSeats?: number;
  freeSeats?: number;
  seatedGuestCount?: number;
}

export interface SeatedGuest {
  id: string;
  customer_name: string;
  party_size: number;
  actual_guests?: number;
  seated_at?: string;
  display_number?: string | number;
  customer_phone?: string;
}

interface ArchitecturalTableProps {
  table: TableItem;
  isSelected: boolean;
  seatedGuests: SeatedGuest[];
  onSelect: () => void;
  onStatusChange: (tableId: string, newStatus: string) => void;
  isPending: boolean;
  nextMatchingGuest?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  availableTablesList?: SeatableTableItem[];
  userId?: string;
  onSeated?: () => void;
}

function formatDiningTime(seatedAt: string | null | undefined): string {
  if (!seatedAt) return '';
  const diffMs = Date.now() - new Date(seatedAt).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

// Color palettes for multi-party shared seating
const PARTY_PALETTES = [
  {
    bg: 'bg-amber-500',
    ring: 'ring-amber-400',
    text: 'text-amber-950',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.7)]',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  {
    bg: 'bg-cyan-500',
    ring: 'ring-cyan-400',
    text: 'text-cyan-950',
    glow: 'shadow-[0_0_12px_rgba(6,182,212,0.7)]',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  },
  {
    bg: 'bg-purple-500',
    ring: 'ring-purple-400',
    text: 'text-purple-950',
    glow: 'shadow-[0_0_12px_rgba(168,85,247,0.7)]',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
  {
    bg: 'bg-emerald-500',
    ring: 'ring-emerald-400',
    text: 'text-emerald-950',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.7)]',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
];

export function ArchitecturalTable({
  table,
  isSelected,
  seatedGuests,
  onSelect,
  onStatusChange,
  isPending,
  nextMatchingGuest,
}: ArchitecturalTableProps) {
  const capacity = table.capacity || 2;
  const isOccupied = table.status === 'OCCUPIED';
  const isAvailable = table.status === 'AVAILABLE';
  const isCleaning = table.status === 'CLEANING';
  const isReserved = table.status === 'RESERVED';

  const occupiedSeats = table.occupiedSeats ?? (isOccupied ? capacity : 0);
  const freeSeats = Math.max(0, capacity - occupiedSeats);
  const isShared = isOccupied && freeSeats > 0 && seatedGuests.length > 0;
  const isMultiParty = seatedGuests.length > 1;

  const shape = table.shape || (capacity > 4 ? 'RECTANGLE' : capacity === 1 ? 'BAR' : 'SQUARE');

  // Normalize table number: "Table 3" -> "T3", "3" -> "T3", "T1" -> "T1"
  const rawNum = String(table.tableNumber || '').trim();
  const numOnly = rawNum.replace(/^tables?\s*/i, '').trim();
  const cleanTableNum = numOnly.toUpperCase().startsWith('T')
    ? numOnly.toUpperCase()
    : `T${numOnly}`;

  // Map each seat index (0..capacity-1) to a seated party, if occupied
  const seatAssignments = useMemo(() => {
    const assignments: Array<{
      isOccupied: boolean;
      guest?: SeatedGuest;
      partyIndex: number;
    }> = [];

    let currentSeat = 0;
    seatedGuests.forEach((guest, pIdx) => {
      const partySeats = guest.actual_guests || guest.party_size || 1;
      for (let s = 0; s < partySeats && currentSeat < capacity; s++) {
        assignments.push({
          isOccupied: true,
          guest,
          partyIndex: pIdx % PARTY_PALETTES.length,
        });
        currentSeat++;
      }
    });

    // Fill remaining occupied seats (if any mismatch)
    while (currentSeat < occupiedSeats && currentSeat < capacity) {
      assignments.push({
        isOccupied: true,
        partyIndex: 0,
      });
      currentSeat++;
    }

    // Fill remaining free seats
    while (assignments.length < capacity) {
      assignments.push({
        isOccupied: false,
        partyIndex: -1,
      });
    }

    return assignments;
  }, [capacity, occupiedSeats, seatedGuests]);

  // Geometric coordinates for seats based on table shape
  const seatPositions = useMemo(() => {
    const positions: Array<{ x: number; y: number; angle: number }> = [];

    if (shape === 'ROUND') {
      const radius = capacity <= 4 ? 68 : 80;
      for (let i = 0; i < capacity; i++) {
        const angle = (2 * Math.PI * i) / capacity - Math.PI / 2;
        positions.push({
          x: Math.round(Math.cos(angle) * radius),
          y: Math.round(Math.sin(angle) * radius),
          angle: Math.round((angle * 180) / Math.PI + 90),
        });
      }
    } else if (shape === 'SQUARE') {
      if (capacity <= 2) {
        positions.push({ x: -68, y: 0, angle: 270 });
        positions.push({ x: 68, y: 0, angle: 90 });
      } else {
        // 4 seats on 4 sides
        positions.push({ x: 0, y: -68, angle: 0 }); // Top
        positions.push({ x: 68, y: 0, angle: 90 }); // Right
        positions.push({ x: 0, y: 68, angle: 180 }); // Bottom
        positions.push({ x: -68, y: 0, angle: 270 }); // Left
        // If square has more than 4, distribute corners
        for (let i = 4; i < capacity; i++) {
          const cornerAngle = (2 * Math.PI * i) / capacity - Math.PI / 4;
          positions.push({
            x: Math.round(Math.cos(cornerAngle) * 72),
            y: Math.round(Math.sin(cornerAngle) * 72),
            angle: Math.round((cornerAngle * 180) / Math.PI + 90),
          });
        }
      }
    } else if (shape === 'RECTANGLE') {
      // Banquet layout: top and bottom rows + ends
      const numLong = Math.max(2, Math.floor(capacity / 2));
      const spacing = numLong > 2 ? 42 : 52;
      const xOffset = ((numLong - 1) * spacing) / 2;

      // Top row
      for (let i = 0; i < numLong; i++) {
        positions.push({
          x: Math.round(-xOffset + i * spacing),
          y: -58,
          angle: 0,
        });
      }
      // Bottom row
      for (let i = 0; i < numLong; i++) {
        positions.push({
          x: Math.round(-xOffset + i * spacing),
          y: 58,
          angle: 180,
        });
      }
      // Ends if capacity is odd or larger
      let remaining = capacity - positions.length;
      if (remaining > 0) {
        positions.push({ x: Math.round(-xOffset - 50), y: 0, angle: 270 });
        remaining--;
      }
      if (remaining > 0) {
        positions.push({ x: Math.round(xOffset + 50), y: 0, angle: 90 });
      }
    } else if (shape === 'BAR') {
      // Stools lined up along front rail
      const spacing = 40;
      const xOffset = ((capacity - 1) * spacing) / 2;
      for (let i = 0; i < capacity; i++) {
        positions.push({
          x: Math.round(-xOffset + i * spacing),
          y: 42,
          angle: 180,
        });
      }
    }

    return positions;
  }, [shape, capacity]);

  // Styling themes based on status
  const theme = useMemo(() => {
    if (isAvailable) {
      return {
        cardBg: 'bg-[#0B1515]/95 border-emerald-500/35 hover:border-emerald-400 shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(16,185,129,0.08)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(16,185,129,0.2)]',
        tableSurface: 'bg-gradient-to-b from-[#142A23] via-[#0D1E18] to-[#07130F] border-2 border-emerald-500/60 shadow-[0_14px_30px_rgba(0,0,0,0.7),0_0_25px_rgba(16,185,129,0.2),inset_0_1px_1px_rgba(255,255,255,0.18)]',
        tableInlay: 'border-emerald-400/30 bg-emerald-500/[0.03]',
        medallionBg: 'bg-emerald-950/80 border-emerald-400/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
        accent: 'text-emerald-400',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
        statusLabel: 'AVAILABLE',
        icon: 'check_circle',
        pillBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        chairFrame: 'border-emerald-500/30 bg-emerald-950/30',
        chairBackrest: 'bg-emerald-900/70 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.2)]',
        cushion: 'bg-gradient-to-b from-emerald-800/60 to-emerald-950/90 border border-emerald-500/50 text-emerald-300 shadow-[0_2px_8px_rgba(0,0,0,0.5)] group-hover/seat:border-emerald-300 group-hover/seat:shadow-[0_0_14px_rgba(16,185,129,0.4)]',
      };
    }
    if (isOccupied) {
      if (isShared) {
        return {
          cardBg: 'bg-[#18130C]/95 border-amber-500/40 hover:border-amber-400 shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(245,158,11,0.1)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(245,158,11,0.25)]',
          tableSurface: 'bg-gradient-to-b from-[#2E1D11] via-[#1F1208] to-[#120904] border-2 border-amber-500/65 shadow-[0_14px_30px_rgba(0,0,0,0.7),0_0_25px_rgba(245,158,11,0.25),inset_0_1px_1px_rgba(255,255,255,0.18)]',
          tableInlay: 'border-amber-400/35 bg-amber-500/[0.04]',
          medallionBg: 'bg-amber-950/80 border-amber-400/50 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
          accent: 'text-amber-400',
          badge: 'bg-amber-500/25 text-amber-300 border-amber-500/50 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.3)]',
          statusLabel: isMultiParty ? 'SHARED • 2+ PARTIES' : 'SHARED SEATS',
          icon: 'groups',
          pillBg: 'bg-amber-500/25 text-amber-300 border-amber-500/50',
          chairFrame: 'border-amber-500/30 bg-amber-950/30',
          chairBackrest: 'bg-amber-900/70 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.2)]',
          cushion: 'bg-gradient-to-b from-amber-800/60 to-amber-950/90 border border-amber-500/50 text-amber-300 shadow-[0_2px_8px_rgba(0,0,0,0.5)] group-hover/seat:border-amber-300 group-hover/seat:shadow-[0_0_14px_rgba(245,158,11,0.4)]',
        };
      }
      return {
        cardBg: 'bg-[#16110A]/95 border-amber-500/35 hover:border-amber-400/80 shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(245,158,11,0.08)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(245,158,11,0.2)]',
        tableSurface: 'bg-gradient-to-b from-[#2B1B0F] via-[#1D1107] to-[#100803] border-2 border-amber-500/60 shadow-[0_14px_30px_rgba(0,0,0,0.7),0_0_25px_rgba(245,158,11,0.2),inset_0_1px_1px_rgba(255,255,255,0.18)]',
        tableInlay: 'border-amber-400/30 bg-amber-500/[0.03]',
        medallionBg: 'bg-amber-950/80 border-amber-400/40 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]',
        accent: 'text-amber-400',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.2)]',
        statusLabel: 'DINING',
        icon: 'restaurant',
        pillBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        chairFrame: 'border-slate-700/40 bg-slate-800/20',
        chairBackrest: 'bg-slate-700/80 border-slate-500/40 shadow-sm',
        cushion: 'bg-slate-800/60 border border-slate-700/50 text-slate-400 shadow-md',
      };
    }
    if (isCleaning) {
      return {
        cardBg: 'bg-[#1C0D13]/95 border-rose-500/40 hover:border-rose-400 shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_25px_rgba(244,63,94,0.12)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.6),0_0_35px_rgba(244,63,94,0.3)]',
        tableSurface: 'bg-gradient-to-b from-[#2E1018] via-[#1E080E] to-[#120408] border-2 border-rose-500/70 shadow-[0_14px_30px_rgba(0,0,0,0.7),0_0_30px_rgba(244,63,94,0.3),inset_0_1px_1px_rgba(255,255,255,0.18)] animate-pulse',
        tableInlay: 'border-rose-400/35 bg-rose-500/[0.04]',
        medallionBg: 'bg-rose-950/80 border-rose-400/50 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]',
        accent: 'text-rose-400',
        badge: 'bg-rose-500/25 text-rose-300 border-rose-500/50 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.3)]',
        statusLabel: 'NEEDS BUSING',
        icon: 'cleaning_services',
        pillBg: 'bg-rose-500/25 text-rose-300 border-rose-500/50',
        chairFrame: 'border-slate-800/40 bg-slate-900/30',
        chairBackrest: 'bg-slate-800/60 border-slate-700/40',
        cushion: 'bg-slate-800/40 border border-slate-700/40 text-slate-500',
      };
    }
    return {
      cardBg: 'bg-[#0E1524]/95 border-blue-500/35 hover:border-blue-400/80 shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(59,130,246,0.08)]',
      tableSurface: 'bg-gradient-to-b from-[#131E36] via-[#0C1527] to-[#060B15] border-2 border-blue-500/50 shadow-[0_14px_30px_rgba(0,0,0,0.7),0_0_25px_rgba(59,130,246,0.18),inset_0_1px_1px_rgba(255,255,255,0.18)]',
      tableInlay: 'border-blue-400/30 bg-blue-500/[0.03]',
      medallionBg: 'bg-blue-950/80 border-blue-400/40 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.2)]',
      accent: 'text-blue-400',
      badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      statusLabel: 'RESERVED',
      icon: 'bookmark',
      pillBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      chairFrame: 'border-blue-500/25 bg-blue-950/30',
      chairBackrest: 'bg-blue-900/60 border-blue-500/40',
      cushion: 'bg-blue-900/40 border border-blue-500/40 text-blue-300',
    };
  }, [isAvailable, isOccupied, isCleaning, isShared, isMultiParty]);

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-3xl p-4 sm:p-5 border transition-all duration-300 cursor-pointer backdrop-blur-xl flex flex-col justify-between overflow-hidden ${
        theme.cardBg
      } ${
        isSelected
          ? 'ring-2 ring-white/70 scale-[1.02] shadow-[0_0_35px_rgba(255,255,255,0.15)] z-20'
          : 'hover:scale-[1.01] hover:-translate-y-1'
      }`}
    >
      {/* Ambient background light flare */}
      <div
        className={`absolute -top-12 -right-12 w-36 h-36 rounded-full blur-3xl pointer-events-none opacity-20 transition-opacity group-hover:opacity-40 ${
          isAvailable
            ? 'bg-emerald-400'
            : isOccupied
            ? 'bg-amber-400'
            : isCleaning
            ? 'bg-rose-500'
            : 'bg-blue-500'
        }`}
      />

      {/* 1. Header Bar: Table ID, Shape, and Live Status Badge */}
      <div className="flex items-center justify-between gap-2.5 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-2.5 h-9 rounded-full shrink-0 ${
              isCleaning
                ? 'bg-rose-500 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                : isShared
                ? 'bg-amber-400 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.6)]'
                : isOccupied
                ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                : isAvailable
                ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                : 'bg-blue-400'
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-black text-white font-mono tracking-tight truncate whitespace-nowrap">
                {cleanTableNum}
              </span>
              <span className="text-[10px] uppercase font-extrabold text-slate-300 bg-white/10 px-2 py-0.5 rounded-full border border-white/10 shrink-0 whitespace-nowrap">
                {shape}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-400 truncate block">
              {table.zoneName || 'Main Dining'}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider border flex items-center gap-1 whitespace-nowrap shadow-sm ${theme.badge}`}
          >
            <span className="material-symbols-outlined text-[12px]">{theme.icon}</span>
            {theme.statusLabel}
          </span>
          <span className="text-[10px] font-mono font-bold text-slate-300 whitespace-nowrap">
            {occupiedSeats} / {capacity} Seats
          </span>
        </div>
      </div>

      {/* 2. Main Stage: Architectural 2D Physical Table & Realistic Diners */}
      <div className="py-7 sm:py-8 flex items-center justify-center relative min-h-[185px] sm:min-h-[195px] select-none z-10">
        {/* Architectural CAD Blueprint Dot Matrix Background */}
        <div className="absolute inset-2 rounded-2xl bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:14px_14px] pointer-events-none" />

        {/* CAD Crosshair Markers in 4 Corners */}
        <span className="absolute top-2 left-2 text-[10px] text-white/10 font-mono pointer-events-none">+</span>
        <span className="absolute top-2 right-2 text-[10px] text-white/10 font-mono pointer-events-none">+</span>
        <span className="absolute bottom-2 left-2 text-[10px] text-white/10 font-mono pointer-events-none">+</span>
        <span className="absolute bottom-2 right-2 text-[10px] text-white/10 font-mono pointer-events-none">+</span>

        {/* Table Center Surface */}
        <div
          className={`relative z-10 transition-all duration-300 flex flex-col items-center justify-center text-center ${
            shape === 'ROUND'
              ? 'rounded-full w-28 h-28 sm:w-32 sm:h-32'
              : shape === 'SQUARE'
              ? 'rounded-2xl w-28 h-28 sm:w-32 sm:h-32'
              : shape === 'BAR'
              ? 'rounded-xl w-48 sm:w-56 h-16'
              : 'rounded-2xl w-40 sm:w-48 h-24 sm:h-26'
          } ${theme.tableSurface}`}
        >
          {/* Inner Inlay Chamfer Milling Line */}
          <div className={`absolute inset-1 sm:inset-1.5 rounded-[inherit] border pointer-events-none ${theme.tableInlay}`} />

          {/* Specular Table Surface Highlight */}
          <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-tr from-transparent via-white/[0.04] to-white/[0.1] pointer-events-none" />

          {/* Table Center Identity & Plaque */}
          <div className="flex flex-col items-center justify-center p-1.5 sm:p-2 z-10">
            {isCleaning ? (
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${theme.medallionBg}`}>
                  <span className="material-symbols-outlined text-rose-400 text-xl animate-bounce">
                    sanitizer
                  </span>
                </div>
                <span className="text-base sm:text-lg font-black text-white font-mono tracking-tight drop-shadow-md leading-none">
                  {cleanTableNum}
                </span>
                <span className={`mt-0.5 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider font-mono ${theme.pillBg}`}>
                  BUSING
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border mb-1 ${theme.medallionBg}`}>
                  <span className="material-symbols-outlined text-[15px] sm:text-[16px]">
                    {shape === 'BAR' ? 'local_bar' : 'dinner_dining'}
                  </span>
                </div>
                <span className="text-base sm:text-lg font-black text-white font-mono tracking-tight drop-shadow-md leading-none">
                  {cleanTableNum}
                </span>
                <span className={`mt-1 px-2 py-0.5 rounded-full border text-[9px] sm:text-[10px] font-black uppercase tracking-wider font-mono flex items-center gap-1 ${theme.pillBg}`}>
                  {isOccupied ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {occupiedSeats} SEATED
                    </>
                  ) : (
                    `${capacity} SEATS`
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Realistic Chairs / Diners around the perimeter */}
        {seatAssignments.map((seat, idx) => {
          const pos = seatPositions[idx] || { x: 0, y: 0, angle: 0 };
          const partyColor = seat.isOccupied
            ? PARTY_PALETTES[seat.partyIndex] || PARTY_PALETTES[0]
            : null;

          return (
            <div
              key={idx}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
              }}
              title={
                seat.isOccupied
                  ? `${seat.guest?.customer_name || 'Guest'} (${formatDiningTime(seat.guest?.seated_at) || 'Dining'})`
                  : 'Empty Seat (Ready)'
              }
              className="absolute z-20 flex items-center justify-center transition-all duration-300 group/seat"
            >
              {/* 1. Underlying Architectural Chair Frame (Rotated to face table) */}
              <div
                style={{ transform: `rotate(${pos.angle}deg)` }}
                className="absolute inset-0 flex flex-col items-center justify-start pointer-events-none -m-1"
              >
                {/* Curved Backrest Bar */}
                <div
                  className={`w-7 h-2 -mt-1 rounded-t-full border transition-all duration-300 ${
                    seat.isOccupied
                      ? 'bg-slate-700/90 border-slate-500/50 shadow-sm'
                      : theme.chairBackrest
                  }`}
                />
                {/* Subtle Frame Silhouette */}
                <div
                  className={`w-6 h-5 rounded-b-md border-x border-b transition-all duration-300 ${
                    seat.isOccupied
                      ? 'border-slate-600/40 bg-slate-800/20'
                      : theme.chairFrame
                  }`}
                />
              </div>

              {/* 2. Seat Content (Always upright) */}
              {seat.isOccupied ? (
                /* Occupied Diner: High-Gloss 3D Avatar Token */
                <div className="relative flex items-center justify-center">
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-black text-xs transition-all duration-200 cursor-pointer shadow-[0_4px_14px_rgba(0,0,0,0.6)] border-2 border-white/90 ring-2 ${
                      partyColor?.ring || 'ring-amber-400'
                    } ${partyColor?.bg || 'bg-amber-500'} ${partyColor?.text || 'text-slate-950'} ${
                      partyColor?.glow || 'shadow-[0_0_12px_rgba(245,158,11,0.6)]'
                    } hover:scale-115 hover:z-30`}
                  >
                    {/* Top Specular Gloss Highlight */}
                    <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-white/10 to-white/40 pointer-events-none" />
                    {seat.guest?.customer_name ? (
                      <span className="truncate max-w-[20px] text-[11px] font-black z-10 drop-shadow-sm">
                        {seat.guest.customer_name.charAt(0).toUpperCase()}
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-[14px] z-10">person</span>
                    )}
                  </div>

                  {/* Interactive Seat Tooltip on hover */}
                  <div className="absolute bottom-full mb-2 hidden group-hover/seat:flex flex-col items-center z-40 pointer-events-none whitespace-nowrap">
                    <div className="bg-[#090D16] border border-amber-500/40 text-white rounded-xl px-3 py-2 shadow-2xl flex flex-col gap-0.5 text-center">
                      <span className="text-xs font-black text-amber-300 flex items-center justify-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">person</span>
                        {seat.guest?.customer_name || 'Seated Diner'}
                      </span>
                      {seat.guest?.party_size && (
                        <span className="text-[10px] text-slate-300 font-semibold">
                          Party of {seat.guest.actual_guests || seat.guest.party_size}
                        </span>
                      )}
                      {seat.guest?.seated_at && (
                        <span className="text-[9px] font-mono text-amber-400 font-bold flex items-center justify-center gap-1 mt-0.5">
                          <span className="material-symbols-outlined text-[11px]">timer</span>
                          {formatDiningTime(seat.guest.seated_at)}
                        </span>
                      )}
                    </div>
                    <div className="w-2 h-2 bg-[#090D16] border-r border-b border-amber-500/40 transform rotate-45 -mt-1" />
                  </div>
                </div>
              ) : (
                /* Available Seat: Cushioned Pad with Subtle Indicator */
                <div className="relative flex items-center justify-center">
                  <div
                    className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer ${theme.cushion}`}
                  >
                    {isCleaning ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                    ) : (
                      <span className="material-symbols-outlined text-[13px] opacity-80 group-hover/seat:opacity-100">
                        chair
                      </span>
                    )}
                  </div>

                  {/* Tooltip for free seat */}
                  <div className="absolute bottom-full mb-1.5 hidden group-hover/seat:flex flex-col items-center z-40 pointer-events-none whitespace-nowrap">
                    <span className="bg-[#090D16] border border-emerald-500/40 text-emerald-300 text-[10px] font-bold rounded-lg px-2.5 py-1 shadow-2xl flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Empty Seat (Ready)
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 3. Footer Context & Direct Interactive Host Quick Actions */}
      <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-2.5 z-10">
        {/* Occupied State with Guest summary & timers */}
        {isOccupied && seatedGuests.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-white font-bold truncate max-w-[150px]">
                <span className="material-symbols-outlined text-amber-400 text-[16px]">
                  person
                </span>
                <span className="truncate">{seatedGuests[0]?.customer_name || 'Guest'}</span>
                {seatedGuests.length > 1 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-slate-300 font-normal">
                    +{seatedGuests.length - 1} more
                  </span>
                )}
              </div>
              <span className="font-mono text-amber-400 font-bold text-[11px] shrink-0 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">timer</span>
                {formatDiningTime(seatedGuests[0]?.seated_at) || 'Just seated'}
              </span>
            </div>

            {/* If shared table, show available spots badge */}
            {isShared && (
              <div className="flex items-center justify-between text-[11px] text-amber-200/90 font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                <span>{occupiedSeats} seated</span>
                <span className="font-bold text-emerald-400">
                  +{freeSeats} open seat{freeSeats > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Occupied State fallback if guest array is empty (e.g. combined secondary table) */}
        {isOccupied && seatedGuests.length === 0 && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
              <span className="material-symbols-outlined text-amber-400 text-[15px]">restaurant</span>
              <span>Active Dining ({occupiedSeats} seated)</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold uppercase">
              Occupied
            </span>
          </div>
        )}

        {/* Cleaning State with 1-Click Fast Action Button */}
        {isCleaning && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-rose-300 font-bold">
              <span className="material-symbols-outlined text-[15px] animate-pulse">
                warning
              </span>
              Table requires sanitization
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(table.id, 'AVAILABLE');
              }}
              className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black shadow-md shadow-emerald-900/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              Mark Clean &amp; Ready
            </button>
          </div>
        )}

        {/* Available State: Ready indicator or 1-Click Fast Seat */}
        {isAvailable && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px]">event_seat</span>
              Ready for up to {capacity}
            </span>

            {/* If matching waiting guest exists, offer quick seating preview */}
            {nextMatchingGuest && (
              <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">bolt</span>
                Match: {nextMatchingGuest.customer_name}
              </span>
            )}
          </div>
        )}

        {/* Reserved State */}
        {isReserved && (
          <div className="flex items-center gap-1.5 text-xs text-blue-400 font-semibold">
            <span className="material-symbols-outlined text-[15px]">lock</span>
            Table held for reservation
          </div>
        )}
      </div>
    </div>
  );
}

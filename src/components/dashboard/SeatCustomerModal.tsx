'use client';

import React, { useState, useTransition, useEffect, useMemo } from 'react';
import { seatQueueEntryAction, recommendTablesAction } from '@/app/dashboard/actions';

const cleanTablePrefix = (str?: string | number | null) => {
  if (str == null) return '';
  return String(str).replace(/^(tables?\s*)+/gi, '').trim();
};
const formatTableHeading = (num?: string | number | null) => {
  const clean = cleanTablePrefix(num);
  return clean ? `Table ${clean}` : 'Table';
};
const formatTableBadge = (num?: string | number | null) => cleanTablePrefix(num);

const getTableNumber = (t?: { table_number?: string; tableNumber?: string } | null): string => {
  if (!t) return '';
  return String(t.table_number || t.tableNumber || '').trim();
};

export interface SeatableTableItem {
  id: string;
  table_number?: string;
  tableNumber?: string;
  capacity: number;
  restaurant_zones?: { name: string } | null;
  zoneName?: string | null;
  is_combination?: boolean;
  is_shared?: boolean;
  table_ids?: string[];
  combination_labels?: string[];
  reason?: string;
}

interface SeatCustomerModalProps {
  entryId: string;
  customerName: string;
  displayNumber: string | null;
  partySize: number;
  userId: string;
  seatableTables: SeatableTableItem[];
  allAvailableTables?: SeatableTableItem[];
  triggerLabel?: string;
  triggerClassName?: string;
  onSeated?: (tableId: string, additionalIds?: string[]) => void;
}

export function SeatCustomerModal({
  entryId,
  customerName,
  displayNumber,
  partySize,
  userId,
  seatableTables,
  allAvailableTables = [],
  triggerLabel,
  triggerClassName,
  onSeated,
}: SeatCustomerModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const [recommended, setRecommended] = useState<SeatableTableItem[] | null>(null);
  // Actual headcount confirmed at the door — defaults to expected party size.
  const [actualGuests, setActualGuests] = useState<number>(partySize);
  const [isCustomCombine, setIsCustomCombine] = useState(false);
  const [customSelectedIds, setCustomSelectedIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-fetch intelligent server-ranked table recommendations on mount / modal open
  useEffect(() => {
    recommendTablesAction(entryId)
      .then((recs) => {
        setRecommended(recs.length > 0 ? (recs as unknown as SeatableTableItem[]) : seatableTables);
      })
      .catch(() => setRecommended(seatableTables));
  }, [isOpen, entryId, partySize, seatableTables]);

  const tablesToShow = useMemo(() => {
    const base = recommended !== null ? recommended : seatableTables;
    // Safety rule: never suggest multi-table combinations for small parties (<= 2 guests),
    // or when single available tables already accommodate the guest count.
    const hasSingleFit =
      base.some((t) => !t.is_combination && (t.capacity || 0) >= actualGuests) ||
      seatableTables.some((t) => !t.is_combination && (t.capacity || 0) >= actualGuests) ||
      allAvailableTables.some((t) => !t.is_combination && (t.capacity || 0) >= actualGuests);

    if (actualGuests <= 2 || hasSingleFit) {
      return base.filter((t) => !t.is_combination);
    }
    return base;
  }, [recommended, seatableTables, allAvailableTables, actualGuests]);

  const handleSeat = (tableId: string, additionalIds: string[] = []) => {
    setSelectedTableId(tableId);
    setErrorMessage(null);
    startTransition(async () => {
      try {
        await seatQueueEntryAction(entryId, tableId, userId, actualGuests, additionalIds);
        onSeated?.(tableId, additionalIds);
        setIsOpen(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to seat customer. The table may have become unavailable.';
        setErrorMessage(msg);
        // Refresh recommendations so staff sees latest available tables
        recommendTablesAction(entryId)
          .then((recs) => {
            setRecommended(recs.length > 0 ? (recs as unknown as SeatableTableItem[]) : seatableTables);
          })
          .catch(() => {});
      }
    });
  };

  const poolTables = allAvailableTables.length > 0 ? allAvailableTables : seatableTables;
  const customSelectedTables = poolTables.filter(t => customSelectedIds.includes(t.id));
  const customTotalCapacity = customSelectedTables.reduce((sum, t) => sum + (t.capacity || 0), 0);

  const toggleCustomTable = (id: string) => {
    setCustomSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          triggerClassName ||
          'w-full sm:w-auto px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold shadow-md transition-all cursor-pointer active:scale-95'
        }
      >
        {triggerLabel || 'Assign Table & Seat'}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0D131F] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 max-w-lg w-full space-y-5 shadow-2xl max-h-[90dvh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 shrink-0">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">
                  Assign Table & Seat
                </span>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  {displayNumber || 'Party'} — {customerName}
                </h3>
                <span className="text-xs text-slate-400">
                  Party of {partySize} ({partySize === 1 ? 'guest' : 'guests'})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1">
              {errorMessage && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs text-rose-300 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-rose-400 text-base">error</span>
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="text-rose-400 hover:text-white font-bold px-1.5 py-0.5 rounded cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Actual headcount: how many guests REALLY came to eat */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 shrink-0">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-300">
                    Guests arrived
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Expected {partySize} — confirm actual headcount
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActualGuests((g) => Math.max(1, g - 1))}
                    disabled={isPending}
                    aria-label="Fewer guests arrived"
                    className="h-9 w-9 rounded-xl bg-slate-800 text-lg font-black text-white hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    −
                  </button>
                  <span aria-live="polite" className="w-8 text-center font-mono text-xl font-black text-white">
                    {actualGuests}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActualGuests((g) => Math.min(50, g + 1))}
                    disabled={isPending}
                    aria-label="More guests arrived"
                    className="h-9 w-9 rounded-xl bg-emerald-600 text-lg font-black text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Mode Toggle: Smart Recommendations vs Custom Multi-Table Combine */}
              {/* Mode Toggle: Smart Recommendations vs Custom Multi-Table Combine */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    {isCustomCombine ? 'Select Multiple Tables to Combine' : 'Available Table Recommendations'}
                  </h4>
                  {!isCustomCombine && (
                    <p className="text-[11px] text-slate-400">
                      Ranked by closest fit to avoid wasted seats
                    </p>
                  )}
                </div>
                {poolTables.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => setIsCustomCombine(!isCustomCombine)}
                    className="text-xs text-purple-400 hover:text-purple-300 font-bold flex items-center gap-1 cursor-pointer py-1 px-2 rounded-lg hover:bg-purple-500/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {isCustomCombine ? 'auto_awesome' : 'tune'}
                    </span>
                    {isCustomCombine ? 'View Recommendations' : 'Custom Combine'}
                  </button>
                )}
              </div>

              {/* CUSTOM COMBINE MODE */}
              {isCustomCombine ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between text-xs text-slate-300">
                    <div>
                      <span className="font-bold text-white">Selected: </span>
                      <span>{customSelectedTables.length} tables ({customTotalCapacity} seats)</span>
                    </div>
                    <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${customTotalCapacity >= actualGuests ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                      {customTotalCapacity >= actualGuests ? `Fits ${actualGuests} guests` : `Need ${actualGuests - customTotalCapacity} more seats`}
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {poolTables.map((t) => {
                      const isChecked = customSelectedIds.includes(t.id);
                      return (
                        <div
                          key={t.id}
                          onClick={() => toggleCustomTable(t.id)}
                          className={`flex items-center justify-between p-3 border rounded-xl cursor-pointer transition-colors ${isChecked ? 'bg-primary/20 border-primary/40' : 'bg-[#111827] border-white/10 hover:border-white/20'}`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 rounded text-primary focus:ring-0 cursor-pointer"
                            />
                            <div>
                              <span className="text-xs font-bold text-white">Table {getTableNumber(t)}</span>
                              <span className="text-[10px] text-slate-400 ml-2">Seats: {t.capacity}</span>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-400">{t.restaurant_zones?.name || t.zoneName || 'Floor'}</span>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={isPending || customSelectedIds.length === 0 || customTotalCapacity < actualGuests}
                    onClick={() => {
                      const primary = customSelectedIds[0];
                      if (!primary) return;
                      handleSeat(primary, customSelectedIds.slice(1));
                    }}
                    className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 font-bold text-sm text-white shadow transition-all cursor-pointer"
                  >
                    {isPending ? 'Assigning...' : `Seat across ${customSelectedIds.length} tables (${customTotalCapacity} seats)`}
                  </button>
                </div>
              ) : (
                /* SMART RECOMMENDATIONS LIST */
                tablesToShow.length === 0 ? (
                  <div className="p-8 text-center bg-[#111827] border border-white/5 rounded-2xl space-y-2">
                    <div className="text-2xl">🚫</div>
                    <h4 className="text-sm font-bold text-rose-400">No Single Table Fits {actualGuests} Guests</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      All single tables have insufficient capacity or are occupied. Use the{' '}
                      <button
                        type="button"
                        onClick={() => setIsCustomCombine(true)}
                        className="text-purple-400 underline font-semibold hover:text-purple-300 inline"
                      >
                        Custom Combine Tables
                      </button>{' '}
                      toggle above to select multiple tables.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {tablesToShow.map((table, idx) => {
                      if (table.is_combination && table.table_ids && table.table_ids.length > 0) {
                        const primaryId = table.table_ids[0];
                        if (!primaryId) return null;
                        const comboLabel = cleanTablePrefix(getTableNumber(table));
                        return (
                          <div
                            key={table.id}
                            className="p-3.5 sm:p-4 border rounded-2xl bg-purple-950/20 border-purple-500/30 hover:border-purple-500/50 transition-all space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                <div className="h-10 px-3 rounded-xl flex flex-col items-center justify-center font-mono font-black text-xs bg-purple-500/20 border border-purple-500/40 text-purple-300 shrink-0">
                                  <span className="text-[9px] uppercase font-sans text-purple-400/80 leading-none">Combo</span>
                                  <span>{comboLabel}</span>
                                </div>
                                <div className="min-w-0 space-y-0.5">
                                  <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-black">Tables {comboLabel}</span>
                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-200 border border-purple-500/30">
                                      Combined: {table.capacity} Seats
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-200 text-[9px] font-black uppercase">
                                      Combine Suggestion
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400">
                                    {table.reason || `Combines tables to fit party of ${actualGuests}`}
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleSeat(primaryId, table.table_ids?.slice(1))}
                                disabled={isPending}
                                className="w-full sm:w-auto px-4 py-2 font-black text-xs rounded-xl bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white transition-colors disabled:opacity-50 cursor-pointer shadow active:scale-95 shrink-0"
                              >
                                {isPending && selectedTableId === primaryId ? 'Assigning...' : `Seat Tables ${comboLabel}`}
                              </button>
                            </div>
                          </div>
                        );
                      }

                      if (table.is_shared) {
                        const sharedNum = formatTableBadge(getTableNumber(table));
                        const sharedHeading = formatTableHeading(getTableNumber(table));
                        return (
                          <div
                            key={table.id}
                            className="p-3.5 sm:p-4 border rounded-2xl bg-amber-950/20 border-amber-500/30 hover:border-amber-500/50 transition-all space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                <div className="h-10 w-10 rounded-xl flex flex-col items-center justify-center font-mono font-black text-xs bg-amber-500/20 border border-amber-500/40 text-amber-300 shrink-0">
                                  <span className="text-[9px] uppercase font-sans text-amber-400/80 leading-none">Shared</span>
                                  <span>{sharedNum}</span>
                                </div>
                                <div className="min-w-0 space-y-0.5">
                                  <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-black">{sharedHeading}</span>
                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-200 border border-amber-500/30">
                                      Total Cap {table.capacity}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200 text-[9px] font-black uppercase">
                                      Shared Table
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400">
                                    {table.reason || 'Shared seating available for this party'}
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleSeat(table.id)}
                                disabled={isPending}
                                className="w-full sm:w-auto px-4 py-2 font-black text-xs rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white transition-colors disabled:opacity-50 cursor-pointer shadow active:scale-95 shrink-0"
                              >
                                {isPending && selectedTableId === table.id ? 'Assigning...' : `Seat at ${sharedHeading}`}
                              </button>
                            </div>
                          </div>
                        );
                      }

                      const cleanNum = cleanTablePrefix(getTableNumber(table));
                      const tableHeading = formatTableHeading(getTableNumber(table));
                      const cap = table.capacity || 0;
                      const extra = cap - actualGuests;
                      const isExact = extra === 0;
                      const isOver = extra > 0;
                      const isRecommended = idx === 0;
                      const zone = table.restaurant_zones?.name || table.zoneName;

                      return (
                        <React.Fragment key={table.id}>
                          {idx === 1 && (
                            <div className="pt-2 pb-1 flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                Alternative Available Tables
                              </span>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>
                          )}
                          <div
                            className={`p-3.5 sm:p-4 border rounded-2xl transition-all ${
                              isRecommended
                                ? 'bg-gradient-to-r from-emerald-950/50 via-[#0F172A] to-emerald-950/30 border-2 border-emerald-500/70 shadow-lg shadow-emerald-950/40 relative overflow-hidden'
                                : 'bg-[#111827] border border-white/10 hover:border-white/20'
                            }`}
                          >
                            {isRecommended && (
                              <div
                                aria-hidden="true"
                                className="pointer-events-none absolute -inset-full top-0 block -rotate-45 bg-gradient-to-r from-transparent via-emerald-400/10 to-transparent opacity-60 animate-[shimmer_3s_infinite]"
                              />
                            )}

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                              {/* Left: Table Identifier & Fit Details */}
                              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                <div
                                  className={`h-11 w-11 rounded-2xl flex flex-col items-center justify-center font-mono shrink-0 shadow-md ${
                                    isRecommended
                                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-950 font-black'
                                      : 'bg-slate-800 border border-white/10 text-white font-bold'
                                  }`}
                                >
                                  <span className={`text-[9px] uppercase font-sans leading-none font-extrabold ${isRecommended ? 'text-slate-950/70' : 'text-slate-400'}`}>
                                    Tbl
                                  </span>
                                  <span className="text-sm font-black leading-tight">{cleanNum}</span>
                                </div>

                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-black text-white tracking-tight">
                                      {tableHeading}
                                    </span>
                                    {isRecommended && (
                                      <span className="px-2 py-0.5 rounded-md bg-emerald-500 text-slate-950 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm">
                                        ⭐ Best Match
                                      </span>
                                    )}
                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/10 text-slate-200 flex items-center gap-1">
                                      <span>🪑</span>
                                      <span>{cap} seats</span>
                                    </span>
                                    {zone && (
                                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300">
                                        📍 {zone}
                                      </span>
                                    )}
                                    {isExact && !isRecommended && (
                                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                                        Exact Fit
                                      </span>
                                    )}
                                  </div>

                                  {/* Dynamic, crystal-clear fit description for staff */}
                                  <p className="text-xs text-slate-300 leading-snug">
                                    {isExact ? (
                                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                        <span>✓</span>
                                        <span>Exact match for {actualGuests} {actualGuests === 1 ? 'guest' : 'guests'} (zero empty seats)</span>
                                      </span>
                                    ) : isOver ? (
                                      <span className="flex items-center gap-1 text-slate-300">
                                        <span>Seats party of {actualGuests}</span>
                                        <span className="text-slate-400">· {extra} extra {extra === 1 ? 'chair' : 'chairs'}</span>
                                      </span>
                                    ) : (
                                      <span className="text-rose-400 font-medium">
                                        ⚠️ Under-capacity (Needs {Math.abs(extra)} more{' '}
                                        {Math.abs(extra) === 1 ? 'seat' : 'seats'})
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>

                              {/* Right: Clear, unambiguous Seat Button */}
                              <button
                                type="button"
                                onClick={() => handleSeat(table.id)}
                                disabled={isPending}
                                className={`w-full sm:w-auto px-4 py-2.5 font-black text-xs rounded-xl transition-all cursor-pointer active:scale-95 shrink-0 shadow-md ${
                                  isRecommended
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 active:brightness-90 text-slate-950 shadow-emerald-950/40 border border-emerald-300/40'
                                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
                                }`}
                              >
                                {isPending && selectedTableId === table.id
                                  ? 'Assigning...'
                                  : `Seat at ${tableHeading}${isRecommended ? ' ⭐' : ''}`}
                              </button>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


'use client';

import React from 'react';
import { Download } from 'lucide-react';

interface CsvRow {
  period: string;
  groups: number;
  guests: number;
  expected: number;
  orders: number;
  revenue: number;
}

/** Client-side CSV download — no server round-trip needed. */
export function FootfallCsvExport({ rows, filename }: { rows: CsvRow[]; filename: string }) {
  const handleExport = () => {
    const header = 'Period,Groups Seated,Guests Arrived,Guests Expected,Orders,Revenue';
    const lines = rows.map((r) =>
      [r.period, r.groups, r.guests, r.expected, r.orders, r.revenue].join(',')
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={rows.length === 0}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-40"
    >
      <Download className="h-4 w-4" />
      Export CSV
    </button>
  );
}

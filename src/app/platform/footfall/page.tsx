import React from 'react';
import Link from 'next/link';
import { BarChart3, ArrowLeft } from 'lucide-react';
import { PlatformService } from '@/lib/services/platform-service';
import { FootfallCsvExport } from '@/components/platform/FootfallCsvExport';
import { logger } from '@/lib/logging/logger';

type Mode = 'day' | 'month';

// Session-dependent analytics: never prerender statically.
export const dynamic = 'force-dynamic';

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseMonth(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(`${s}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toISOMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export default async function PlatformFootfallPage({
  searchParams,
}: {
  searchParams: Promise<{ restaurant?: string; mode?: string; days?: string; months?: string; end?: string; endMonth?: string }>;
}) {
  const params = await searchParams;
  const mode: Mode = params.mode === 'month' ? 'month' : 'day';
  const restaurantFilter = params.restaurant && params.restaurant !== 'all' ? params.restaurant : undefined;

  const now = new Date();
  let from: Date;
  let to: Date;
  let granularity: 'day' | 'month';

  if (mode === 'month') {
    const months = Math.min(24, Math.max(1, parseInt(params.months || '12', 10) || 12));
    const endM = parseMonth(params.endMonth, now);
    to = new Date(Date.UTC(endM.getUTCFullYear(), endM.getUTCMonth() + 1, 0, 23, 59, 59));
    from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (months - 1), 1, 0, 0, 0));
    granularity = 'month';
  } else {
    const days = Math.min(90, Math.max(1, parseInt(params.days || '14', 10) || 14));
    const endD = parseDate(params.end, now);
    to = new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate(), 23, 59, 59));
    from = new Date(to.getTime() - (days - 1) * 86400000);
    from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0));
    granularity = 'day';
  }

  const [data, restaurants] = await Promise.all([
    PlatformService.getFootfallAnalytics({
      restaurantId: restaurantFilter,
      fromISO: from.toISOString(),
      toISO: to.toISOString(),
      granularity,
    }).catch((err) => {
      logger.warn('Footfall page: analytics failed', {
        operation: 'platform_footfall',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }),
    PlatformService.listRestaurants({ page: 1, limit: 100 }).catch(() => ({ restaurants: [] as Array<{ id: string; name: string }> })),
  ]);

  const restList = (restaurants as { restaurants: Array<{ id: string; name: string }> }).restaurants || [];
  const buckets = data?.buckets || [];
  const byRestaurant = data?.byRestaurant || [];
  const totals = data?.totals || { groups: 0, guests: 0, expected: 0, orders: 0, revenue: 0 };
  const maxGuests = Math.max(1, ...buckets.map((b) => b.guests));

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      restaurant: params.restaurant || 'all',
      mode,
      days: params.days || '14',
      months: params.months || '12',
      end: params.end || toISODate(now),
      endMonth: params.endMonth || toISOMonth(now),
      ...over,
    });
    return `/platform/footfall?${p.toString()}`;
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center gap-3">
        <Link href="/platform" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            <BarChart3 className="h-6 w-6 text-orange-400" /> Footfall Analytics
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">How many people came — per restaurant, day wise or month wise</p>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        <Link
          href={qs({ mode: 'day' })}
          className={`rounded-xl px-5 py-2.5 text-xs font-black uppercase tracking-wider transition-all ${mode === 'day' ? 'bg-emerald-600 text-white shadow-lg' : 'border border-slate-800 bg-slate-900 text-slate-400 hover:text-white'}`}
        >
          📅 Day wise
        </Link>
        <Link
          href={qs({ mode: 'month' })}
          className={`rounded-xl px-5 py-2.5 text-xs font-black uppercase tracking-wider transition-all ${mode === 'month' ? 'bg-emerald-600 text-white shadow-lg' : 'border border-slate-800 bg-slate-900 text-slate-400 hover:text-white'}`}
        >
          🗓️ Month wise
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:flex-row sm:items-end">
        <input type="hidden" name="mode" value={mode} />
        <label className="flex-1 text-xs font-bold text-slate-300">
          Restaurant
          <select name="restaurant" defaultValue={params.restaurant || 'all'} className="mt-1.5 h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none">
            <option value="all">All restaurants</option>
            {restList.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        {mode === 'day' ? (
          <>
            <label className="text-xs font-bold text-slate-300 sm:w-36">
              Range
              <select name="days" defaultValue={params.days || '14'} className="mt-1.5 h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none">
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-300 sm:w-44">
              Ending
              <input type="date" name="end" defaultValue={params.end || toISODate(now)} max={toISODate(now)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none" />
            </label>
          </>
        ) : (
          <>
            <label className="text-xs font-bold text-slate-300 sm:w-36">
              Range
              <select name="months" defaultValue={params.months || '12'} className="mt-1.5 h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none">
                <option value="6">Last 6 months</option>
                <option value="12">Last 12 months</option>
                <option value="24">Last 24 months</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-300 sm:w-44">
              Ending
              <input type="month" name="endMonth" defaultValue={params.endMonth || toISOMonth(now)} max={toISOMonth(now)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none" />
            </label>
          </>
        )}
        <div className="flex gap-2">
          <button type="submit" className="h-11 flex-1 rounded-xl bg-emerald-600 px-6 text-xs font-black text-white shadow-lg transition-all hover:bg-emerald-500 sm:flex-none">
            Apply
          </button>
          <FootfallCsvExport
            rows={buckets.map((b) => ({ period: b.key, groups: b.groups, guests: b.guests, expected: b.expected, orders: b.orders, revenue: b.revenue }))}
            filename={`footfall-${mode}-${toISODate(now)}.csv`}
          />
        </div>
      </form>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          { label: 'Guests arrived', value: totals.guests.toLocaleString('en-IN'), hint: `expected ${totals.expected.toLocaleString('en-IN')}` },
          { label: 'Groups seated', value: totals.groups.toLocaleString('en-IN'), hint: `${buckets.length} ${mode === 'day' ? 'days' : 'months'}` },
          { label: 'Orders placed', value: totals.orders.toLocaleString('en-IN'), hint: 'non-cancelled' },
          { label: 'Revenue', value: `₹${totals.revenue.toLocaleString('en-IN')}`, hint: 'order totals' },
          { label: 'Avg party', value: totals.groups > 0 ? (totals.guests / totals.groups).toFixed(1) : '—', hint: 'guests / group' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-2xl font-extrabold tabular-nums text-white">{k.value}</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{k.label}</div>
            <div className="text-[11px] text-slate-500">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Bar chart (CSS only) */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-slate-300">
          Guests arrived · {mode === 'day' ? 'per day' : 'per month'}
        </h3>
        {buckets.every((b) => b.guests === 0) ? (
          <p className="py-10 text-center text-sm text-slate-500">No seatings in this period yet.</p>
        ) : (
          <div className="flex h-44 items-end gap-1 overflow-x-auto sm:gap-1.5" role="img" aria-label={`Bar chart of guests per ${mode}`}>
            {buckets.map((b) => (
              <div key={b.key} className="group flex h-full min-w-[14px] flex-1 flex-col items-center justify-end gap-1" title={`${b.label}: ${b.guests} guests, ${b.groups} groups`}>
                <span className="text-[10px] font-bold tabular-nums text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">{b.guests > 0 ? b.guests : ''}</span>
                <div
                  className={`w-full rounded-t-md transition-all ${b.guests > 0 ? 'bg-gradient-to-t from-orange-600 to-amber-400 group-hover:brightness-110' : 'bg-slate-800'}`}
                  style={{ height: `${Math.max(b.guests > 0 ? 4 : 2, (b.guests / maxGuests) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span>{buckets[0]?.label}</span>
          <span>{buckets[buckets.length - 1]?.label}</span>
        </div>
      </div>

      {/* Detail table */}
      <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-slate-300">
          {mode === 'day' ? 'Daily breakdown' : 'Monthly breakdown'}
        </h3>
        <table className="w-full text-left text-sm">
          <thead className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 pb-3">{mode === 'day' ? 'Date' : 'Month'}</th>
              <th className="px-3 pb-3 text-right">Groups</th>
              <th className="px-3 pb-3 text-right">Guests arrived</th>
              <th className="px-3 pb-3 text-right">Expected</th>
              <th className="px-3 pb-3 text-right">Orders</th>
              <th className="px-3 pb-3 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {[...buckets].reverse().map((b) => (
              <tr key={b.key} className="transition-colors hover:bg-slate-800/30">
                <td className="px-3 py-2.5 font-bold text-white">{b.label}</td>
                <td className="px-3 py-2.5 text-right font-mono">{b.groups}</td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-300">{b.guests}</td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-400">{b.expected}</td>
                <td className="px-3 py-2.5 text-right font-mono">{b.orders}</td>
                <td className="px-3 py-2.5 text-right font-mono">₹{b.revenue.toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-700 font-bold text-white">
              <td className="px-3 pt-3">Total</td>
              <td className="px-3 pt-3 text-right font-mono">{totals.groups}</td>
              <td className="px-3 pt-3 text-right font-mono text-emerald-300">{totals.guests}</td>
              <td className="px-3 pt-3 text-right font-mono">{totals.expected}</td>
              <td className="px-3 pt-3 text-right font-mono">{totals.orders}</td>
              <td className="px-3 pt-3 text-right font-mono">₹{totals.revenue.toLocaleString('en-IN')}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Per-restaurant comparison (all-restaurants view) */}
      {!restaurantFilter && byRestaurant.length > 1 && (
        <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-slate-300">By restaurant</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 pb-3">Restaurant</th>
                <th className="px-3 pb-3 text-right">Groups</th>
                <th className="px-3 pb-3 text-right">Guests arrived</th>
                <th className="px-3 pb-3 text-right">Orders</th>
                <th className="px-3 pb-3 text-right">Revenue</th>
                <th className="px-3 pb-3 text-right">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {byRestaurant.map((r) => (
                <tr key={r.restaurantId} className="transition-colors hover:bg-slate-800/30">
                  <td className="px-3 py-2.5 font-bold text-white">{r.restaurantName}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{r.groups}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-300">{r.guests}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{r.orders}</td>
                  <td className="px-3 py-2.5 text-right font-mono">₹{r.revenue.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href={qs({ restaurant: r.restaurantId })} className="text-xs font-bold text-emerald-400 hover:text-emerald-300">View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

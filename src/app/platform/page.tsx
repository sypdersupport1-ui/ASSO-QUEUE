import React from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  UserCog,
  Ban,
  Archive,
  CheckCircle2,
  Activity,
  Store,
  ChevronRight,
  ShieldAlert,
  UtensilsCrossed,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { PlatformService } from '@/lib/services/platform-service';
import { logger } from '@/lib/logging/logger';

function startOfTodayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

// Session-dependent cockpit: never prerender statically (kills the
// DynamicServerError build warning and documents dynamic intent).
export const dynamic = 'force-dynamic';

function daysAgoUTC(n: number): Date {
  const t = startOfTodayUTC();
  t.setUTCDate(t.getUTCDate() - n);
  return t;
}

export default async function PlatformDashboardPage() {
  // Every section degrades independently — one failing query never 500s the page.
  const [stats, audit, today, last7, last30, restaurants] = await Promise.all([
    PlatformService.getPlatformStats().catch((err) => {
      logger.warn('Platform dashboard: stats failed', {
        operation: 'platform_dashboard',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }),
    PlatformService.listAuditLogs({ page: 1, limit: 8 }).catch(() => ({ logs: [] as unknown[] })),
    PlatformService.getFootfallAnalytics({
      fromISO: startOfTodayUTC().toISOString(),
      toISO: new Date().toISOString(),
      granularity: 'day',
    }).catch(() => null),
    PlatformService.getFootfallAnalytics({
      fromISO: daysAgoUTC(6).toISOString(),
      toISO: new Date().toISOString(),
      granularity: 'day',
    }).catch(() => null),
    PlatformService.getFootfallAnalytics({
      fromISO: daysAgoUTC(29).toISOString(),
      toISO: new Date().toISOString(),
      granularity: 'day',
    }).catch(() => null),
    PlatformService.listRestaurants({ page: 1, limit: 100 }).catch(() => ({ restaurants: [] as unknown[] })),
  ]);

  const s = stats || {
    totalRestaurants: 0,
    activeRestaurants: 0,
    suspendedRestaurants: 0,
    archivedRestaurants: 0,
    totalAdmins: 0,
    totalStaff: 0,
  };
  const logs = (audit as { logs?: Array<{ id: string; createdAt: string; action: string; actor?: { name?: string; email?: string } | null; restaurant?: { name?: string } | null }> }).logs || [];
  const restRows = (restaurants as { restaurants?: Array<{ id: string; name: string; slug: string; status: string; city?: string | null; assignedAdmin?: { name: string; email: string } | null }> }).restaurants || [];

  const guestsByRest = (data: { byRestaurant: Array<{ restaurantId: string; guests: number; groups: number }> } | null) => {
    const m = new Map<string, { guests: number; groups: number }>();
    for (const r of data?.byRestaurant || []) m.set(r.restaurantId, { guests: r.guests, groups: r.groups });
    return m;
  };
  const g7 = guestsByRest(last7);
  const g30 = guestsByRest(last30);

  const kpis = [
    { label: 'Guests today', sub: `${today?.totals.groups || 0} groups seated`, value: today?.totals.guests ?? 0, icon: UtensilsCrossed, accent: 'text-orange-400 border-orange-500/20 bg-orange-500/10' },
    { label: 'Guests · last 7 days', sub: `${last7?.totals.groups || 0} groups`, value: last7?.totals.guests ?? 0, icon: TrendingUp, accent: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' },
    { label: 'Guests · last 30 days', sub: `${last30?.totals.groups || 0} groups`, value: last30?.totals.guests ?? 0, icon: BarChart3, accent: 'text-blue-400 border-blue-500/20 bg-blue-500/10' },
    { label: 'Total Restaurants', sub: `${s.activeRestaurants} active`, value: s.totalRestaurants, icon: Building2, accent: 'text-violet-400 border-violet-500/20 bg-violet-500/10' },
    { label: 'Tenant Admins', sub: `${s.totalStaff} staff`, value: s.totalAdmins, icon: UserCog, accent: 'text-indigo-400 border-indigo-500/20 bg-indigo-500/10' },
    { label: 'Suspended', sub: `${s.archivedRestaurants} archived`, value: s.suspendedRestaurants, icon: Ban, accent: 'text-amber-400 border-amber-500/20 bg-amber-500/10' },
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Platform Control Center</h1>
          <p className="mt-1 text-sm text-slate-400">Live multi-tenant overview · footfall, tenants & audit</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/platform/footfall"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-500"
          >
            <BarChart3 className="h-4 w-4" /> Footfall Analytics
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
        </div>
      </div>

      {/* KPI cards — live */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-md transition-all hover:bg-slate-800/80">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${k.accent}`}>
              <k.icon className="h-4 w-4" />
            </div>
            <div className="mt-3 text-3xl font-extrabold tabular-nums text-white">{k.value.toLocaleString('en-IN')}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{k.label}</div>
            <div className="text-[11px] text-slate-500">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Per-restaurant footfall */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-orange-400" />
            <h3 className="text-lg font-bold text-white">Footfall by Restaurant</h3>
          </div>
          <Link href="/platform/footfall" className="group flex items-center gap-1 text-sm font-semibold text-emerald-400 transition-colors hover:text-emerald-300">
            Day / month wise <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        {restRows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No restaurants yet — create your first tenant below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 pb-3">Restaurant</th>
                  <th className="px-4 pb-3">Status</th>
                  <th className="px-4 pb-3">Admin</th>
                  <th className="px-4 pb-3 text-right">Today</th>
                  <th className="px-4 pb-3 text-right">Last 7 days</th>
                  <th className="px-4 pb-3 text-right">Last 30 days</th>
                  <th className="px-4 pb-3 text-right">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {restRows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-bold text-white">{r.name}</div>
                      <div className="text-[11px] text-slate-500">{r.city || r.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${r.status === 'ACTIVE' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : r.status === 'SUSPENDED' ? 'border-amber-500/20 bg-amber-500/10 text-amber-400' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                        {r.status === 'ACTIVE' && <CheckCircle2 className="h-3 w-3" />}
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{r.assignedAdmin ? `${r.assignedAdmin.name} · ${r.assignedAdmin.email}` : <span className="text-amber-400">No admin assigned</span>}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-white">{(guestsByRest(today).get(r.id)?.guests ?? 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">{(g7.get(r.id)?.guests ?? 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">{(g30.get(r.id)?.guests ?? 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/platform/footfall?restaurant=${r.id}&mode=day`} className="text-xs font-bold text-emerald-400 hover:text-emerald-300">View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          <Archive className="mr-1 inline h-3 w-3" />
          Counts = guests actually seated (seat-time headcount, falls back to expected party size). Day boundaries in UTC.
        </p>
      </div>

      {/* Action Banner */}
      <div className="relative flex flex-col items-center justify-between overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-r from-slate-900 via-emerald-950/20 to-slate-900 p-8 shadow-2xl md:flex-row">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-[80px]" />
        <div className="relative z-10 mb-6 md:mb-0">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <Store className="h-6 w-6 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Manage Restaurant Tenants</h2>
          </div>
          <p className="max-w-md text-sm text-slate-400">Onboard new restaurants, manage status lifecycle, or assign tenant admins across the QueueFlow network.</p>
        </div>
        <div className="relative z-10 flex w-full items-center gap-4 md:w-auto">
          <Link href="/platform/restaurants" className="flex-1 rounded-xl border border-slate-700 bg-slate-800/80 px-6 py-3 text-center text-sm font-semibold text-slate-200 shadow-lg backdrop-blur-md transition-all hover:bg-slate-700 hover:text-white md:flex-none">
            View Directory
          </Link>
          <Link href="/platform/restaurants/new" className="flex-1 rounded-xl bg-emerald-600 px-6 py-3 text-center text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 hover:shadow-emerald-500/40 md:flex-none">
            + New Tenant
          </Link>
        </div>
      </div>

      {/* Recent Activity Table — live */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-sm">
        <div className="mb-6 flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            <h3 className="text-lg font-bold text-white">Recent Audit Activity</h3>
          </div>
          <Link href="/platform/audit-logs" className="group flex items-center gap-1 text-sm font-semibold text-blue-400 transition-colors hover:text-blue-300">
            View full log <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="mb-3 h-12 w-12 text-slate-700" />
            <div className="text-sm font-medium text-slate-400">No administrative audit activity recorded yet.</div>
            <div className="mt-1 text-xs text-slate-500">Actions performed by staff will appear here.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 pb-4">Timestamp</th>
                  <th className="px-4 pb-4">Action</th>
                  <th className="px-4 pb-4">Actor</th>
                  <th className="px-4 pb-4">Restaurant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {logs.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-slate-800/30">
                    <td className="px-4 py-4 font-mono text-xs text-slate-500">{new Date(log.createdAt).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-400">{log.action}</span>
                    </td>
                    <td className="px-4 py-4 font-medium">{log.actor?.name || log.actor?.email || 'System'}</td>
                    <td className="px-4 py-4 text-slate-400">{log.restaurant?.name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

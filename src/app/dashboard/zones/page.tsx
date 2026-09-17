import React from 'react';
import Link from 'next/link';
import { ZoneService } from '@/lib/services/zone-service';
import { updateZoneStatusAction, createZoneFormAction } from '../actions';
import { can } from '@/lib/auth/ui-permissions';
import { PERMISSIONS } from '@/lib/auth/permissions';

export default async function ZonesPage() {
  const { zones } = await ZoneService.listZones();
  const canCreate = await can(PERMISSIONS.TABLES_CREATE);
  const canUpdate = await can(PERMISSIONS.TABLES_UPDATE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white">Zones & Sections</h1>
          <p className="text-sm text-slate-400">Configure physical dining areas, dining halls, and outdoor sections</p>
        </div>
        <Link
          href="/dashboard/tables"
          className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
        >
          View Tables &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Create Zone Form */}
        {canCreate && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4 h-fit">
            <h2 className="text-lg font-bold text-white">Add New Zone</h2>
            <form action={createZoneFormAction} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300">Zone Name *</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Indoor Main Hall"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">Description</label>
                <input
                  type="text"
                  name="description"
                  placeholder="e.g. Ground floor AC seating area"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">Sort Order</label>
                <input
                  type="number"
                  name="sortOrder"
                  defaultValue="0"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500"
              >
                + Create Zone
              </button>
            </form>
          </div>
        )}

        {/* Zone List */}
        <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-6 ${canCreate ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <h2 className="text-lg font-bold text-white mb-4">Configured Zones</h2>

          {zones.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No zones configured yet. Add your first zone to organize tables.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {zones.map((zone: { id: string; name: string; description: string | null; sortOrder: number; status: string; tableCount: number }) => {
                const deactivateAction = updateZoneStatusAction.bind(null, zone.id, 'INACTIVE');
                const activateAction = updateZoneStatusAction.bind(null, zone.id, 'ACTIVE');

                return (
                  <div key={zone.id} className="py-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">{zone.name}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            zone.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/10 text-red-400 border border-red-500/30'
                          }`}
                        >
                          {zone.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{zone.description || 'No description'}</p>
                      <div className="mt-2 text-[11px] font-mono text-slate-500">
                        {zone.tableCount} Active Table{zone.tableCount === 1 ? '' : 's'} assigned
                      </div>
                    </div>

                    {canUpdate && (
                      <div>
                        {zone.status === 'ACTIVE' ? (
                          <form action={deactivateAction}>
                            <button
                              type="submit"
                              className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/20"
                            >
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <form action={activateAction}>
                            <button
                              type="submit"
                              className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
                            >
                              Activate
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

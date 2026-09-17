import React from 'react';
import Link from 'next/link';
import { PlatformService } from '@/lib/services/platform-service';
import { updateStatusAction, removeTeamMemberAction } from '../actions';
import { AssignAdminForm, AddTeamMemberForm } from './TeamForms';
import DeleteRestaurantForm from '../DeleteRestaurantForm';
import { logger } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;

  const [restaurant, team, audit] = await Promise.all([
    PlatformService.getRestaurantById(restaurantId),
    PlatformService.listRestaurantTeam(restaurantId).catch((err) => {
      logger.warn('Platform restaurant detail: team failed', {
        operation: 'platform_restaurant_detail',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return [];
    }),
    PlatformService.listRestaurantAudit(restaurantId, 15).catch(() => []),
  ]);

  async function handleActivate() {
    'use server';
    await updateStatusAction(restaurantId, 'ACTIVE');
  }
  async function handleSuspend() {
    'use server';
    await updateStatusAction(restaurantId, 'SUSPENDED');
  }
  async function handleArchive() {
    'use server';
    await updateStatusAction(restaurantId, 'ARCHIVED');
  }

  const admins = team.filter((m) => m.role === 'RESTAURANT_ADMIN' && m.status === 'ACTIVE');
  const staffActive = team.filter((m) => m.role === 'STAFF' && m.status === 'ACTIVE');
  const invited = team.filter((m) => m.status === 'INVITED');
  const inactive = team.filter((m) => m.status === 'INACTIVE');

  return (
    <div className="space-y-6 pb-12">
      <div>
        <Link href="/platform/restaurants" className="text-xs text-emerald-400 hover:underline">
          &larr; Back to Restaurants
        </Link>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold text-white">{restaurant.name}</h1>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  restaurant.status === 'ACTIVE'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : restaurant.status === 'SUSPENDED'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {restaurant.status}
              </span>
            </div>
            <p className="mt-1 text-xs font-mono text-slate-500">
              /{restaurant.slug} &bull; ID: {restaurant.id}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Public queue: <Link href={`/q/${restaurant.slug}`} className="text-emerald-400 hover:underline">/q/{restaurant.slug}</Link>
              {' · '}Footfall: <Link href={`/platform/footfall?restaurant=${restaurant.id}&mode=day`} className="text-emerald-400 hover:underline">view analytics →</Link>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/platform/restaurants/${restaurant.id}/edit`}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              Edit Info
            </Link>
            {restaurant.status === 'SUSPENDED' && (
              <form action={handleActivate}>
                <button type="submit" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20">
                  Activate
                </button>
              </form>
            )}
            {restaurant.status === 'ACTIVE' && (
              <form action={handleSuspend}>
                <button type="submit" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20">
                  Suspend
                </button>
              </form>
            )}
            {restaurant.status !== 'ARCHIVED' && (
              <form action={handleArchive}>
                <button type="submit" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20">
                  Archive
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Operational summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Tables', restaurant.counts.tables],
          [`Staff (${staffActive.length} active)`, restaurant.counts.staff],
          ['Menu Items', restaurant.counts.menuItems],
          ['Queue Entries', restaurant.counts.queueEntries],
          ['Total Orders', restaurant.counts.orders],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <span className="block text-xs text-slate-500 font-medium">{label}</span>
            <span className="text-xl font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Restaurant info */}
        <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h2 className="text-base font-bold text-white">Restaurant Information</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div><span className="block text-slate-500 font-medium">Phone</span><span className="text-slate-200">{restaurant.phone || '-'}</span></div>
            <div><span className="block text-slate-500 font-medium">Email</span><span className="text-slate-200">{restaurant.email || '-'}</span></div>
            <div><span className="block text-slate-500 font-medium">Address</span><span className="text-slate-200">{restaurant.address || '-'}</span></div>
            <div><span className="block text-slate-500 font-medium">City / State / Country</span><span className="text-slate-200">{restaurant.city || '-'} {restaurant.state || ''} {restaurant.country || ''}</span></div>
            <div><span className="block text-slate-500 font-medium">Timezone</span><span className="text-slate-200">{restaurant.timezone}</span></div>
            <div><span className="block text-slate-500 font-medium">Currency</span><span className="text-slate-200">{restaurant.currency}</span></div>
            <div className="col-span-2"><span className="block text-slate-500 font-medium">Description</span><span className="text-slate-300">{restaurant.description || 'No description provided.'}</span></div>
            <div><span className="block text-slate-500 font-medium">Created</span><span className="text-slate-300">{restaurant.created_at ? new Date(restaurant.created_at).toLocaleString('en-IN') : '-'}</span></div>
            <div><span className="block text-slate-500 font-medium">Last updated</span><span className="text-slate-300">{restaurant.updated_at ? new Date(restaurant.updated_at).toLocaleString('en-IN') : '-'}</span></div>
          </div>

          {/* Team roster — previously invisible to the super admin */}
          <div className="pt-4 border-t border-slate-800">
            <h3 className="text-sm font-bold text-white">
              Team Access ({team.length})
              <span className="ml-2 text-[11px] font-medium text-slate-500">
                {admins.length} admin{admins.length === 1 ? '' : 's'} · {staffActive.length} active staff
                {invited.length > 0 && ` · ${invited.length} invited`}
                {inactive.length > 0 && ` · ${inactive.length} inactive`}
              </span>
            </h3>
            {team.length === 0 ? (
              <p className="mt-2 text-xs text-amber-400">No team members — assign an admin so this restaurant can operate.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Member</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 text-right font-medium">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {team.map((m) => (
                      <tr key={m.membershipId}>
                        <td className="py-2 pr-3">
                          <div className="font-semibold text-white">{m.name}</div>
                          <div className="text-[11px] text-slate-500">{m.email}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.role === 'RESTAURANT_ADMIN' ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                            {m.role}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.status === 'ACTIVE' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : m.status === 'INVITED' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-slate-700 bg-slate-800 text-slate-500'}`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {m.status !== 'INACTIVE' && (
                            <form action={removeTeamMemberAction.bind(null, restaurantId, m.userId)}>
                              <button type="submit" className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400">
                                Remove
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent audit for this restaurant */}
          <div className="pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Recent Activity</h3>
              <Link href={`/platform/audit-logs?restaurantId=${restaurantId}`} className="text-[11px] font-semibold text-blue-400 hover:text-blue-300">
                Full log →
              </Link>
            </div>
            {audit.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No audit activity recorded for this restaurant yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-xs text-slate-400">
                {audit.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-500">{new Date(l.createdAt).toLocaleString('en-IN')}</span>
                    <span className="inline-flex rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-400">{l.action}</span>
                    <span className="truncate">{l.actor?.name || l.actor?.email || 'System'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Admin + staff provisioning */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
            <h2 className="text-base font-bold text-white">Assigned Restaurant Admin</h2>
            {restaurant.assignedAdmin ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <div className="font-bold text-white">{restaurant.assignedAdmin.display_name}</div>
                <div className="text-slate-400">{restaurant.assignedAdmin.email}</div>
                <div className="mt-1 text-[11px] text-emerald-400 font-semibold">✓ Active Administrator</div>
              </div>
            ) : (
              <div className="text-xs text-amber-400 italic">No admin assigned yet to this restaurant.</div>
            )}
            <AssignAdminForm restaurantId={restaurantId} />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
            <h2 className="text-base font-bold text-white">Team Logins</h2>
            <AddTeamMemberForm restaurantId={restaurantId} />
          </div>

          {/* Danger zone: hard delete */}
          <div id="danger" className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 space-y-3">
            <h2 className="text-base font-bold text-red-400">Danger Zone</h2>
            <p className="text-[11px] text-slate-400">
              Suspending / archiving keeps data. Deleting permanently removes the restaurant, its queues, orders,
              menu, tables and history. Staff login accounts are kept.
            </p>
            <DeleteRestaurantForm restaurantId={restaurantId} slug={restaurant.slug} name={restaurant.name} />
          </div>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import Link from 'next/link';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { resendStaffInvitationAction, updateStaffStatusAction } from '../actions';
import { can } from '@/lib/auth/ui-permissions';
import { PERMISSIONS } from '@/lib/auth/permissions';

export default async function StaffListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: 'ACTIVE' | 'INVITED' | 'INACTIVE' | '' | undefined }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const search = params.search || '';
  const status = params.status || '';

  const canCreateStaff = await can(PERMISSIONS.STAFF_CREATE);
  const canActivateStaff = await can(PERMISSIONS.STAFF_ACTIVATE);
  const canDeactivateStaff = await can(PERMISSIONS.STAFF_DEACTIVATE);

  const result = await RestaurantAdminService.listStaff({
    page,
    limit: 10,
    search,
    status: status || undefined,
  });
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white">Staff Management</h1>
          <p className="text-sm text-slate-400">Manage floor staff members and team account access</p>
        </div>
        {canCreateStaff && (
          <Link
            href="/dashboard/staff/new"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500"
          >
            + Add Staff Member
          </Link>
        )}
      </div>

      {/* Filter and Search Bar */}
      <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search staff name or email..."
          className="w-full rounded-lg border border-white/10 bg-[#0A0E17] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none sm:w-64"
        />

        <select
          name="status"
          className="w-full rounded-lg border border-white/10 bg-[#0A0E17] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none sm:w-40"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INVITED">INVITED</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>

        <button
          type="submit"
          className="rounded-lg border border-white/5 bg-[#1A2333] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
        >
          Filter
        </button>
      </form>

      {/* Staff Members Table */}
      <div className="rounded-2xl border border-white/5 bg-[#111827] shadow-sm p-4 sm:p-6">
        {result.staff.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No staff members found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/5 text-slate-400 font-medium">
                <tr>
                  <th className="py-3 px-3">Name</th>
                  <th className="py-3 px-3">Email</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Assigned Date</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {result.staff.map((member) => {
                  const deactivateAction = updateStaffStatusAction.bind(null, member.userId, 'INACTIVE');
                  const activateAction = updateStaffStatusAction.bind(null, member.userId, 'ACTIVE');
                  const resendAction = resendStaffInvitationAction.bind(null, member.userId);

                  return (
                    <tr key={member.id} className="hover:bg-white/5">
                      <td className="py-3.5 px-3 font-semibold text-white">{member.name}</td>
                      <td className="py-3.5 px-3 text-slate-400">{member.email}</td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center rounded border border-white/5 bg-[#1A2333] px-2 py-0.5 text-[10px] font-mono text-slate-300">
                          {member.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            member.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/10 text-red-400 border border-red-500/30'
                          }`}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            member.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : member.status === 'INVITED'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                : 'bg-red-500/10 text-red-400 border border-red-500/30'
                          }`}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-mono text-slate-400">
                        {member.status === 'ACTIVE' ? (
                          new Date(member.createdAt).toLocaleDateString()
                        ) : member.status === 'INVITED' ? (
                          <span className="text-xs text-amber-400">
                            Invited {new Date(member.invitedAt ?? member.createdAt).toLocaleDateString()}
                          </span>
                        ) : (
                          new Date(member.createdAt).toLocaleDateString()
                        )}
                      </td>
<td className="py-3.5 px-3 text-right">
                        {member.status === 'ACTIVE' ? (
                          canDeactivateStaff ? (
                            <form action={deactivateAction} className="inline-block">
                              <button
                                type="submit"
                                className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/20"
                              >
                                Deactivate
                              </button>
                            </form>
                          ) : (
                            <span className="text-[11px] text-slate-500">Active</span>
                          )
                        ) : member.status === 'INVITED' ? (
                          <span className="inline-flex items-center gap-2">
                            {canCreateStaff ? (
                              <form action={resendAction} className="inline-block">
                                <button
                                  type="submit"
                                  title="Send a fresh invitation email"
                                  className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/20"
                                >
                                  Resend Invitation
                                </button>
                              </form>
                            ) : (
                              <span className="text-[11px] text-slate-500">Invitation pending</span>
                            )}
                            {canDeactivateStaff && (
                              <form action={deactivateAction} className="inline-block">
                                <button
                                  type="submit"
                                  title="Cancel this invitation"
                                  className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/20"
                                >
                                  Cancel
                                </button>
                              </form>
                            )}
                          </span>
                        ) : member.status === 'INACTIVE' ? (
                          canActivateStaff ? (
                            <form action={activateAction} className="inline-block">
                              <button
                                type="submit"
                                className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
                              >
                                Activate
                              </button>
                            </form>
                          ) : (
                            <span className="text-[11px] text-slate-500">Inactive</span>
                          )
                        ) : (
                          canDeactivateStaff ? (
                            <form action={deactivateAction} className="inline-block">
                              <button
                                type="submit"
                                className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/20"
                              >
                                Deactivate
                              </button>
                            </form>
                          ) : (
                            <span className="text-[11px] text-slate-500">Inactive</span>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Navigation */}
        {result.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4 text-xs">
            <span className="text-slate-500">
              Page {result.page} of {result.totalPages} ({result.total} total)
            </span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <Link
                  href={`/dashboard/staff?page=${result.page - 1}&search=${encodeURIComponent(search)}&status=${status}`}
                  className="rounded border border-white/10 bg-[#1A2333] px-3 py-1 text-slate-300 hover:bg-white/10"
                >
                  Previous
                </Link>
              )}
              {result.page < result.totalPages && (
                <Link
                  href={`/dashboard/staff?page=${result.page + 1}&search=${encodeURIComponent(search)}&status=${status}`}
                  className="rounded border border-white/10 bg-[#1A2333] px-3 py-1 text-slate-300 hover:bg-white/10"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

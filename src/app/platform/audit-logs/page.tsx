import React from 'react';
import Link from 'next/link';
import { PlatformService } from '@/lib/services/platform-service';

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string; restaurantId?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const action = params.action || '';
  const restaurantId = params.restaurantId || '';

  const result = await PlatformService.listAuditLogs({
    page,
    limit: 15,
    action: action || undefined,
    restaurantId: restaurantId || undefined,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-white">Administrative Audit Logs</h1>
        <p className="text-sm text-slate-400">Append-only log of platform security and management events</p>
      </div>

      {/* Filter Options */}
      <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          name="action"
          defaultValue={action}
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none sm:w-56"
        >
          <option value="">All Actions</option>
          <option value="restaurant_created">restaurant_created</option>
          <option value="restaurant_updated">restaurant_updated</option>
          <option value="restaurant_activated">restaurant_activated</option>
          <option value="restaurant_suspended">restaurant_suspended</option>
          <option value="restaurant_archived">restaurant_archived</option>
          <option value="restaurant_deleted">restaurant_deleted</option>
          <option value="restaurant_admin_assigned">restaurant_admin_assigned</option>
          <option value="team_member_provisioned">team_member_provisioned</option>
        </select>

        <button
          type="submit"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Filter
        </button>
      </form>

      {/* Audit Logs Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        {result.logs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No audit logs found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 font-medium">
                <tr>
                  <th className="py-3 px-3">Timestamp</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Actor</th>
                  <th className="py-3 px-3">Restaurant</th>
                  <th className="py-3 px-3">Entity Type / ID</th>
                  <th className="py-3 px-3">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {result.logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-900/40">
                    <td className="py-3 px-3 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-bold text-emerald-400">{log.action}</td>
                    <td className="py-3 px-3">
                      <div>{log.actor?.name || 'System User'}</div>
                      <div className="text-[11px] text-slate-500">{log.actor?.email || '-'}</div>
                    </td>
                    <td className="py-3 px-3">
                      {log.restaurant ? (
                        <div>
                          <div className="font-semibold text-slate-200">{log.restaurant.name}</div>
                          <div className="text-[11px] font-mono text-slate-500">/{log.restaurant.slug}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500">Platform</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                      <div>{log.entityType}</div>
                      <div className="text-slate-500 truncate max-w-[120px]">{log.entityId}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                      <pre className="max-w-xs overflow-x-auto text-[10px] text-slate-300 bg-slate-950 p-1.5 rounded">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Navigation */}
        {result.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4 text-xs">
            <span className="text-slate-500">
              Page {result.page} of {result.totalPages} ({result.total} total)
            </span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <Link
                  href={`/platform/audit-logs?page=${result.page - 1}&action=${action}&restaurantId=${restaurantId}`}
                  className="rounded border border-slate-800 bg-slate-900 px-3 py-1 text-slate-300 hover:bg-slate-800"
                >
                  Previous
                </Link>
              )}
              {result.page < result.totalPages && (
                <Link
                  href={`/platform/audit-logs?page=${result.page + 1}&action=${action}&restaurantId=${restaurantId}`}
                  className="rounded border border-slate-800 bg-slate-900 px-3 py-1 text-slate-300 hover:bg-slate-800"
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

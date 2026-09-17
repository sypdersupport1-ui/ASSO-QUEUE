import React from 'react';
import Link from 'next/link';
import { PlatformService } from '@/lib/services/platform-service';
import type { RestaurantStatus } from '@/types/database.types';
import DeleteRestaurantForm from './DeleteRestaurantForm';

export default async function RestaurantsListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const search = params.search || '';
  const status = (params.status || '') as RestaurantStatus | '';

  const result = await PlatformService.listRestaurants({
    page,
    limit: 10,
    search,
    status: status || undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white">Restaurants</h1>
          <p className="text-sm text-slate-400">Multi-tenant restaurant control center</p>
        </div>
        <Link
          href="/platform/restaurants/new"
          className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500"
        >
          + Create Restaurant
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search name, slug, city..."
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none sm:w-64"
        />

        <select
          name="status"
          defaultValue={status}
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none sm:w-40"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>

        <button
          type="submit"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Filter
        </button>
      </form>

      {/* Restaurant List Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        {result.restaurants.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No restaurants found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 font-medium">
                <tr>
                  <th className="py-3 px-3">Restaurant</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Location</th>
                  <th className="py-3 px-3">Assigned Admin</th>
                  <th className="py-3 px-3">Created Date</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {result.restaurants.map((restaurant) => (
                  <tr key={restaurant.id} className="hover:bg-slate-900/40">
                    <td className="py-3.5 px-3 font-semibold text-white">
                      <div>{restaurant.name}</div>
                      <div className="text-[11px] font-mono text-slate-500">/{restaurant.slug}</div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          restaurant.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : restaurant.status === 'SUSPENDED'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {restaurant.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-3">
                      {restaurant.city || '-'}
                      {restaurant.state ? `, ${restaurant.state}` : ''}
                    </td>
                    <td className="py-3.5 px-3">
                      {restaurant.assignedAdmin ? (
                        <div>
                          <div className="font-semibold text-slate-200">{restaurant.assignedAdmin.name}</div>
                          <div className="text-[11px] text-slate-500">{restaurant.assignedAdmin.email}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-400">
                      {new Date(restaurant.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/platform/restaurants/${restaurant.id}`}
                          className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          Manage &rarr;
                        </Link>
                        <DeleteRestaurantForm
                          compact
                          restaurantId={restaurant.id}
                          slug={restaurant.slug}
                          name={restaurant.name}
                        />
                      </div>
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
                  href={`/platform/restaurants?page=${result.page - 1}&search=${encodeURIComponent(search)}&status=${status}`}
                  className="rounded border border-slate-800 bg-slate-900 px-3 py-1 text-slate-300 hover:bg-slate-800"
                >
                  Previous
                </Link>
              )}
              {result.page < result.totalPages && (
                <Link
                  href={`/platform/restaurants?page=${result.page + 1}&search=${encodeURIComponent(search)}&status=${status}`}
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

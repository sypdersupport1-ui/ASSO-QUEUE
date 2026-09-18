'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { updateRestaurantAction } from '../../actions';

type Initial = {
  name: string;
  slug: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
  currency: string;
  dine_in_customer_ordering_enabled?: boolean;
  dine_in_staff_ordering_enabled?: boolean;
  takeaway_customer_ordering_enabled?: boolean;
  takeaway_staff_ordering_enabled?: boolean;
};

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none';
const labelCls = 'block text-xs font-medium text-slate-300';

export default function EditRestaurantForm({
  restaurantId,
  initial,
}: {
  restaurantId: string;
  initial: Initial;
}) {
  const updateActionWithId = updateRestaurantAction.bind(null, restaurantId);
  const [state, formAction, isPending] = useActionState(updateActionWithId, null);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href={`/platform/restaurants/${restaurantId}`} className="text-xs text-emerald-400 hover:underline">
          &larr; Back to Restaurant Details
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold text-white">Edit Restaurant</h1>
        <p className="text-sm text-slate-400">Update restaurant profile information</p>
      </div>

      {state?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400">
          {state.error}
        </div>
      )}

      <form action={formAction} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Restaurant Name *</label>
            <input type="text" name="name" required defaultValue={initial.name} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Unique Slug *</label>
            <input type="text" name="slug" required defaultValue={initial.slug} pattern="[a-z0-9-]+" title="Lowercase letters, numbers and hyphens only" className={`${inputCls} font-mono`} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <textarea name="description" rows={3} defaultValue={initial.description} className={inputCls} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Phone</label>
            <input type="text" name="phone" defaultValue={initial.phone} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" name="email" defaultValue={initial.email} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Address</label>
          <input type="text" name="address" defaultValue={initial.address} className={inputCls} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>City</label>
            <input type="text" name="city" defaultValue={initial.city} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>State</label>
            <input type="text" name="state" defaultValue={initial.state} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Country</label>
            <input type="text" name="country" defaultValue={initial.country} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Timezone</label>
            <input type="text" name="timezone" defaultValue={initial.timezone} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Currency</label>
            <input type="text" name="currency" defaultValue={initial.currency} className={inputCls} />
          </div>
        </div>

        {/* ORDERING CAPABILITIES CONFIGURATION */}
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Outlet Ordering Capabilities
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Configure which ordering mechanisms are enabled for this outlet. Queue functions independently.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Dine-In Ordering */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2">
              <span className="text-xs font-bold text-white block">🍽️ Dine-In Ordering</span>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  name="dine_in_customer_ordering_enabled"
                  value="true"
                  defaultChecked={initial.dine_in_customer_ordering_enabled ?? true}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Customer Self-Ordering</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  name="dine_in_staff_ordering_enabled"
                  value="true"
                  defaultChecked={initial.dine_in_staff_ordering_enabled ?? true}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Staff Counter Ordering</span>
              </label>
            </div>

            {/* Takeaway Ordering */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2">
              <span className="text-xs font-bold text-white block">🛍️ Takeaway Ordering</span>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  name="takeaway_customer_ordering_enabled"
                  value="true"
                  defaultChecked={initial.takeaway_customer_ordering_enabled ?? true}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Customer Self-Ordering</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  name="takeaway_staff_ordering_enabled"
                  value="true"
                  defaultChecked={initial.takeaway_staff_ordering_enabled ?? true}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Staff Counter Ordering</span>
              </label>
            </div>
          </div>
        </div>

        <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
          <Link
            href={`/platform/restaurants/${restaurantId}`}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

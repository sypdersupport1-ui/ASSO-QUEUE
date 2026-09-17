'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { createStaffFormAction } from '../../actions';

export default function NewStaffPage() {
  const [state, formAction, isPending] = useActionState(createStaffFormAction, null);

  return (
    <div className="max-w-md space-y-6">
      <div>
        <Link href="/dashboard/staff" className="text-xs text-emerald-400 hover:underline">
          &larr; Back to Staff Management
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold text-white">Add Staff Member</h1>
        <p className="text-sm text-slate-400">Invite a team member to access operational features</p>
      </div>

      {state?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400">
          {state.error}
        </div>
      )}

      <form action={formAction} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300">Staff Full Name *</label>
          <input
            type="text"
            name="displayName"
            required
            placeholder="e.g. Jane Doe"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300">Email Address *</label>
          <input
            type="email"
            name="email"
            required
            placeholder="jane@restaurant.com"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300">Assigned Role *</label>
          <select
            name="role"
            defaultValue="STAFF"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          >
            <option value="STAFF">STAFF (Floor Operator)</option>
            <option value="RESTAURANT_ADMIN">RESTAURANT_ADMIN (Co-manager)</option>
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">
            Invited accounts have access restricted to your restaurant. Platform
            (Super Admin) access cannot be granted from here.
          </span>
        </div>

        <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
          <Link
            href="/dashboard/staff"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {isPending ? 'Inviting...' : 'Add Staff Member'}
          </button>
        </div>
      </form>
    </div>
  );
}

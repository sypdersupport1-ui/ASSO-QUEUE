import React from 'react';
import { getUser } from '@/lib/auth/session';
import { signOutAction } from '@/app/login/actions';

export default async function StaffOperationalPortalPage() {
  const user = await getUser();

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100 flex flex-col items-center justify-center">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl text-center space-y-6">
        <div className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
          Staff Operational Portal
        </div>

        <div>
          <h1 className="text-2xl font-extrabold text-white">Floor Staff Workspace</h1>
          <p className="text-xs text-slate-400 mt-1">Logged in as {user?.email}</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-xs text-slate-400 space-y-2 text-left">
          <div className="font-semibold text-slate-200 border-b border-slate-800 pb-1">Operational Access Active</div>
          <div>&bull; Queue management and waitlist control</div>
          <div>&bull; Table seating and assignment</div>
          <div>&bull; Order status controls and kitchen dispatch</div>
        </div>

        <form action={signOutAction}>
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );
}

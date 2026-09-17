import React from 'react';
import Link from 'next/link';
import { getUser } from '@/lib/auth/session';
import { signOutAction } from '@/app/login/actions';

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar Navigation */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-lg">
              QF
            </div>
            <div>
              <h2 className="font-bold text-white leading-tight">QueueFlow</h2>
              <span className="text-xs font-semibold text-emerald-400">Super Admin</span>
            </div>
          </div>

          <nav className="space-y-1">
            <Link
              href="/platform"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/platform/footfall"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Footfall
            </Link>
            <Link
              href="/platform/restaurants"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Restaurants
            </Link>
            <Link
              href="/platform/audit-logs"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Audit Logs
            </Link>
            <Link
              href="/platform/settings"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Settings
            </Link>
          </nav>
        </div>

        {/* User Account / Sign Out Footer */}
        <div className="border-t border-slate-800 pt-4">
          <div className="mb-3 px-1">
            <div className="truncate text-xs font-semibold text-slate-200">
              {user?.email || 'Super Admin'}
            </div>
            <div className="text-xs text-slate-500">Platform Administrator</div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-colors"
            >
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

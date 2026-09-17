import React from 'react';

export default function PlatformSettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold text-white">Platform Settings</h1>
        <p className="text-sm text-slate-400">System configuration and security defaults</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <h2 className="text-base font-bold text-white">Security Baseline</h2>
        <div className="space-y-2 text-xs text-slate-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span>Multi-Tenant Row Level Security (RLS)</span>
            <span className="font-semibold text-emerald-400">&check; Enabled (DB Level)</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span>Server-Side Role Authorization</span>
            <span className="font-semibold text-emerald-400">&check; Enforced</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span>Transient Cache & Rate Limiting</span>
            <span className="font-semibold text-emerald-400">&check; Resilient Fallback Active</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span>Customer Token Protection</span>
            <span className="font-semibold text-emerald-400">&check; SHA-256 Hashed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

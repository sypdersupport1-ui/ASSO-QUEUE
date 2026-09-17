import React from 'react';

export function PartyPreferencesCard({ customerName, phone, partySize }: { customerName: string, phone: string | null, partySize: number }) {
  const initials = (customerName && customerName.trim().length >= 2) ? customerName.trim().substring(0, 2).toUpperCase() : (customerName?.trim().substring(0,1).toUpperCase() || 'G');
  const maskedPhone = phone ? `${phone.slice(0,2)}****${phone.slice(-4)}` : null;
  return (
    <div className="animate-fadeUp flex w-full flex-col gap-3" style={{ animationDelay: '220ms' }}>
      <div className="flex items-center justify-between px-1">
        <h3 className="qf-keep-dark text-lg font-black tracking-tight text-white">Your party 🎉</h3>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-300">✓ Confirmed</span>
      </div>

      {/* User Info - production clean */}
      <div className="qf-card flex items-center justify-between rounded-3xl p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-black text-white shadow-lg">
            {initials}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-black text-white">{customerName || 'Guest'}</span>
            <span className="mt-0.5 truncate text-xs text-slate-300">{maskedPhone ? `📱 ${maskedPhone} · SMS updates on` : '📵 No phone · keep this ticket open'}</span>
          </div>
        </div>
      </div>

      {/* Party Size */}
      <div className="flex flex-col gap-2 px-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Party size</span>
        <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-orange-400/25 bg-orange-500/10 px-4 py-2.5">
           <span className="material-symbols-outlined text-[20px] text-orange-300">group</span>
           <span className="text-base font-black text-white">{partySize} {partySize === 1 ? 'Guest' : 'Guests'}</span>
        </div>
      </div>
    </div>
  );
}

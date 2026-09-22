'use client';

import Link from 'next/link';

/**
 * Phase 3D — floating "my ticket" shortcut.
 * Prop-only: renders solely from the token supplied by the hosting page
 * (which received it via URL). Never reads or writes browser storage —
 * raw tokens must not persist in localStorage / sessionStorage / cookies.
 */
export function CustomerTicketFloat({ slug, qtoken }: { slug: string; qtoken?: string | null }) {
  if (!qtoken) return null;
  const token = qtoken;

  return (
    <Link
      href={`/q/${slug}/status/${token}`}
      className="fixed top-3.5 right-3.5 z-40 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-slate-900/90 text-slate-200 border border-white/20 text-xs font-bold shadow-xl backdrop-blur-md hover:bg-slate-800 hover:text-white active:scale-95 transition-all"
    >
      <span className="material-symbols-outlined text-[15px] text-emerald-400">confirmation_number</span>
      <span>My Ticket</span>
    </Link>
  );
}

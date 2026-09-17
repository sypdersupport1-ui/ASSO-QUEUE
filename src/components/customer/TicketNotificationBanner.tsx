import React from 'react';
import { BellRing } from 'lucide-react';

export interface TicketNotification {
  id: string;
  title: string;
  message: string;
}

/**
 * Phase 4C — Existing-notification display for the ticket.
 *
 * Server-rendered from notifications already persisted for this entry
 * (fetched in the page, scoped by entry+restaurant). Renders the latest
 * ONE relevant banner — never a stack, never re-created per refresh, no
 * client fetching, no extra timer, no sounds, no permission prompts.
 * External delivery (SMS/WhatsApp/email) is explicitly out of scope.
 */
export function TicketNotificationBanner({
  notification,
}: {
  notification: TicketNotification | null;
}) {
  if (!notification) return null;

  return (
    <div
      role="status"
      aria-label={`Notification: ${notification.title}. ${notification.message}`}
      className="flex items-start gap-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.08] px-3.5 py-3"
    >
      <BellRing aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-300">
          {notification.title}
        </p>
        <p className="mt-0.5 break-words text-[12px] font-medium leading-snug text-slate-200">
          {notification.message}
        </p>
      </div>
    </div>
  );
}

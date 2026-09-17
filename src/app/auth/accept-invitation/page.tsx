import React from 'react';
import Link from 'next/link';
import { AcceptInvitationForm } from './AcceptInvitationForm';
import { getAcceptInvitationContext } from './actions';
import { dashboardPathForRole } from '@/lib/services/staff-invitation-service';
import { createServerClient } from '@/lib/db/supabase/server';

const ERROR_MESSAGES: Record<string, string> = {
  expired:
    'This invitation link has expired or was already used. Ask your administrator to resend the invitation, then click the fresh link.',
  invalid:
    'This invitation link is invalid. Please use the latest invitation email, or ask your administrator to resend it.',
};

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const linkError = params.error ? ERROR_MESSAGES[params.error] : null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No invitation session: the link is expired/invalid, or the user
  // navigated here directly without clicking an invitation link.
  if (!user) {
    return (
      <main className="min-h-screen bg-[#0A0E17] text-white flex items-center justify-center p-6">
        <div className="bg-[#111827] border border-white/5 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl">
          <div className="text-4xl">✉️</div>
          <h1 className="text-xl font-bold text-white">Invitation Required</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            {linkError ??
              'Please click the secure link in your invitation email to set up your staff account. Direct visits to this page cannot establish an invitation session.'}
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center w-full h-11 rounded-xl bg-white text-[#0A0E17] font-bold text-sm hover:bg-slate-100"
          >
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  const context = await getAcceptInvitationContext();
  const invited = context?.invited ?? [];
  const hasPending = invited.length > 0;
  const fallbackPath = dashboardPathForRole(invited[0]?.role);

  return (
    <main className="min-h-screen bg-[#0A0E17] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1.5">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            {hasPending ? 'Set Up Your Staff Account' : 'Staff Account'}
          </h1>
          <p className="text-[12px] sm:text-xs text-slate-400 leading-relaxed px-2">
            {hasPending
              ? `You've been invited${invited.length === 1 ? ` to join ${invited[0]?.restaurantName}` : ` to ${invited.length} restaurants`} as ${invited[0]?.role}. Choose a password to activate your access.`
              : 'Your staff access is already active — you can head straight to your dashboard.'}
          </p>
          {linkError && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center font-medium leading-relaxed">
              {linkError}
            </div>
          )}
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-8 shadow-2xl">
          <AcceptInvitationForm
            alreadyOnboarded={!hasPending}
            dashboardPath={fallbackPath}
          />
        </div>

        <p className="text-center text-[11px] text-slate-500">
          Invitation for {user.email ?? 'your account'} • Links expire — ask your
          administrator for a fresh invitation if needed.
        </p>
      </div>
    </main>
  );
}

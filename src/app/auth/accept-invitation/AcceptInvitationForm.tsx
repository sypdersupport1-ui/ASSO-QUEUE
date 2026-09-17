'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/db/supabase/client';
import { acceptStaffInvitationAction } from './actions';

type Step = 'password' | 'activating' | 'done';

export function AcceptInvitationForm({
  alreadyOnboarded,
  dashboardPath,
}: {
  alreadyOnboarded: boolean;
  dashboardPath: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(alreadyOnboarded ? 'done' : 'password');
  const [isPending, startTransition] = useTransition();

  if (step === 'done') {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-4">
        <div className="text-4xl">🎉</div>
        <h2 className="text-lg font-bold text-white">You&apos;re all set!</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          {alreadyOnboarded
            ? 'Your account is already active. Head to your dashboard to continue.'
            : 'Your password is set and your staff access is active.'}
        </p>
        <button
          onClick={() => router.push(dashboardPath)}
          className="inline-flex items-center justify-center w-full h-11 rounded-xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-400"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    startTransition(async () => {
      try {
        setStep('activating');

        // 1. Set the password DIRECTLY with Supabase Auth.
        // The password never passes through application code or APIs.
        const supabase = createBrowserClient();
        const { error: pwError } = await supabase.auth.updateUser({ password });
        if (pwError) {
          setStep('password');
          setError(
            pwError.message.includes('session')
              ? 'Your invitation session has expired. Please click the invitation link again or ask your administrator to resend it.'
              : `Could not set password: ${pwError.message}`
          );
          return;
        }

        // 2. Activate the matching INVITED membership(s) server-side.
        const result = await acceptStaffInvitationAction();
        if (!result.success) {
          setStep('password');
          setError(result.error ?? 'Failed to activate your access. Please try again.');
          return;
        }

        router.push(result.dashboardPath ?? dashboardPath);
      } catch {
        setStep('password');
        setError('Something went wrong. Please try again.');
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center font-medium leading-relaxed">
          {error}
        </div>
      )}
      {step === 'activating' && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs text-center font-medium">
          Securing your account…
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="new-password" className="block text-xs font-black text-white uppercase tracking-widest">
          Choose a password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isPending}
          placeholder="Minimum 6 characters"
          className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3.5 text-white text-[15px] placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm-password" className="block text-xs font-black text-white uppercase tracking-widest">
          Confirm password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending}
          placeholder="Repeat your password"
          className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3.5 text-white text-[15px] placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full h-[52px] bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 text-white font-black text-[15px] rounded-2xl transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isPending ? (
          <>
            <span className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Setting up…
          </>
        ) : (
          'Set Password & Activate Access'
        )}
      </button>
    </form>
  );
}

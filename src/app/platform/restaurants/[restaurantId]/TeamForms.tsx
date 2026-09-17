'use client';

import { useActionState, useState } from 'react';
import { assignAdminAction, createTeamMemberAction } from '../actions';

type State = { success: boolean; error: string } | null;

function PasswordField({
  name,
  required = false,
  placeholder,
}: {
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const gen = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    setValue(Array.from(buf, (n) => chars[n % chars.length]).join(''));
  };
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        minLength={6}
        placeholder={placeholder}
        autoComplete="new-password"
        className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 pr-20 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
        <button
          type="button"
          onClick={gen}
          title="Generate a strong password"
          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/10"
        >
          Gen
        </button>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-400 hover:bg-slate-800"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

export function AssignAdminForm({ restaurantId }: { restaurantId: string }) {
  const bound = assignAdminAction.bind(null, restaurantId);
  const [state, formAction, isPending] = useActionState<State, FormData>(bound as never, null);
  return (
    <form action={formAction} className="space-y-3 pt-2 border-t border-slate-800">
      <span className="block text-xs font-semibold text-slate-300">Assign / Replace Admin</span>
      {state?.error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] font-medium text-red-400">
          {state.error}
        </div>
      )}
      <div>
        <label className="block text-[11px] text-slate-400">Display Name *</label>
        <input
          type="text"
          name="displayName"
          required
          placeholder="Manager Name"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-[11px] text-slate-400">Admin Email *</label>
        <input
          type="email"
          name="email"
          required
          placeholder="admin@restaurant.com"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-[11px] text-slate-400">Password (blank = auto-generate)</label>
        <div className="mt-1">
          <PasswordField name="password" placeholder="Set a password or leave blank" />
        </div>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {isPending ? 'Assigning…' : 'Assign Restaurant Admin'}
      </button>
      <p className="text-[11px] text-slate-500">Replaces the current admin. The previous admin loses access but their login is kept.</p>
    </form>
  );
}

export function AddTeamMemberForm({ restaurantId }: { restaurantId: string }) {
  const bound = createTeamMemberAction.bind(null, restaurantId);
  const [state, formAction, isPending] = useActionState<State, FormData>(bound as never, null);
  return (
    <form action={formAction} className="space-y-3 pt-2 border-t border-slate-800">
      <span className="block text-xs font-semibold text-slate-300">Add Staff / Admin Login</span>
      {state?.error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] font-medium text-red-400">
          {state.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-slate-400">Name *</label>
          <input
            type="text"
            name="displayName"
            required
            placeholder="Staff Name"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400">Role *</label>
          <select
            name="role"
            defaultValue="STAFF"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
          >
            <option value="STAFF">STAFF</option>
            <option value="RESTAURANT_ADMIN">ADMIN</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] text-slate-400">Email *</label>
        <input
          type="email"
          name="email"
          required
          placeholder="staff@restaurant.com"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-[11px] text-slate-400">Password * (min 6 chars)</label>
        <div className="mt-1">
          <PasswordField name="password" required placeholder="Set their password" />
        </div>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {isPending ? 'Adding…' : 'Add Team Member'}
      </button>
      <p className="text-[11px] text-slate-500">Login works immediately — no email invite needed. Share the credentials securely.</p>
    </form>
  );
}

'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { createRestaurantWithTeamAction } from '../actions';

type StaffRow = { email: string; displayName: string; password: string; role: 'STAFF' | 'RESTAURANT_ADMIN' };

function slugify(v: string) {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function randomPassword(len = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

function PasswordInput({
  name,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={6}
        placeholder={placeholder}
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-20 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-1">
        <button
          type="button"
          onClick={() => onChange(randomPassword())}
          title="Generate a strong password"
          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/10"
        >
          Gen
        </button>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

export default function NewRestaurantPage() {
  const [state, formAction, isPending] = useActionState(createRestaurantWithTeamAction, null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [staff, setStaff] = useState<StaffRow[]>([]);

  const staffJson = useMemo(() => JSON.stringify(staff.filter((s) => s.email.trim() !== '')), [staff]);

  const addStaff = () =>
    setStaff((rows) => [...rows, { email: '', displayName: '', password: randomPassword(), role: 'STAFF' }]);
  const updateStaff = (i: number, patch: Partial<StaffRow>) =>
    setStaff((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeStaff = (i: number) => setStaff((rows) => rows.filter((_, idx) => idx !== i));

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <div>
        <Link href="/platform/restaurants" className="text-xs text-emerald-400 hover:underline">
          &larr; Back to Restaurants
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold text-white">Onboard Restaurant</h1>
        <p className="text-sm text-slate-400">
          Restaurant profile + admin login with password + staff logins — one seamless step. Logins work immediately, no email invites.
        </p>
      </div>

      {state?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-6">
        {/* Step 1 — Restaurant */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">1</span>
            <h2 className="text-base font-bold text-white">Restaurant profile</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">Restaurant Name *</label>
              <input
                type="text"
                name="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="e.g. Le Petit Bistro"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Unique Slug *</label>
              <input
                type="text"
                name="slug"
                required
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="e.g. le-petit-bistro"
                pattern="[a-z0-9-]+"
                title="Lowercase letters, numbers and hyphens only"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              {slug && <p className="mt-1 text-[11px] text-slate-500">Public queue URL: <span className="font-mono text-slate-400">/q/{slug}</span></p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Description</label>
            <textarea
              name="description"
              rows={2}
              placeholder="Brief description of the establishment..."
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">Phone</label>
              <input type="text" name="phone" placeholder="+91 98765 43210" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Contact Email</label>
              <input type="email" name="email" placeholder="contact@bistro.com" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Address</label>
            <input type="text" name="address" placeholder="123 Main Street" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300">City</label>
              <input type="text" name="city" placeholder="Mumbai" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">State</label>
              <input type="text" name="state" placeholder="MH" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Country</label>
              <input type="text" name="country" placeholder="India" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Timezone</label>
              <input type="text" name="timezone" defaultValue="Asia/Kolkata" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Currency</label>
              <input type="text" name="currency" defaultValue="INR" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
            </div>
          </div>
        </section>

        {/* Step 2 — Admin login */}
        <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">2</span>
            <h2 className="text-base font-bold text-white">Admin login <span className="text-xs font-medium text-slate-400">(works immediately)</span></h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">Admin Name</label>
              <input
                type="text"
                name="adminName"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Manager Name"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Admin Email</label>
              <input
                type="email"
                name="adminEmail"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@restaurant.com"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Admin Password {adminEmail.trim() ? '*' : '(required if admin email is set)'}</label>
            <PasswordInput name="adminPassword" value={adminPassword} onChange={setAdminPassword} placeholder="Set the admin's password" required={adminEmail.trim() !== ''} />
            <p className="mt-1 text-[11px] text-slate-500">Min 6 characters. Save it somewhere safe — this is what the admin signs in with.</p>
          </div>
        </section>

        {/* Step 3 — Staff logins */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">3</span>
              <h2 className="text-base font-bold text-white">Staff logins <span className="text-xs font-medium text-slate-400">(optional)</span></h2>
            </div>
            <button
              type="button"
              onClick={addStaff}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              + Add staff
            </button>
          </div>
          <input type="hidden" name="staffJson" value={staffJson} />
          {staff.length === 0 ? (
            <p className="text-xs text-slate-500">No staff yet. You can also add them later from the restaurant page.</p>
          ) : (
            <div className="space-y-3">
              {staff.map((row, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-[1fr_1fr] lg:grid-cols-[1fr_1fr_1fr_130px_auto]">
                  <input
                    type="text"
                    value={row.displayName}
                    onChange={(e) => updateStaff(i, { displayName: e.target.value })}
                    placeholder="Staff name"
                    aria-label="Staff name"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="email"
                    value={row.email}
                    onChange={(e) => updateStaff(i, { email: e.target.value })}
                    placeholder="staff@restaurant.com"
                    aria-label="Staff email"
                    className="mt-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <PasswordInput value={row.password} onChange={(v) => updateStaff(i, { password: v })} name={`staff-password-${i}`} placeholder="Password" />
                  <select
                    value={row.role}
                    onChange={(e) => updateStaff(i, { role: e.target.value as StaffRow['role'] })}
                    aria-label="Staff role"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="STAFF">STAFF</option>
                    <option value="RESTAURANT_ADMIN">ADMIN</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeStaff(i)}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/platform/restaurants"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {isPending ? 'Onboarding…' : 'Create Restaurant + Logins'}
          </button>
        </div>
      </form>
    </div>
  );
}

'use client';

import React, { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { updateProfileFormAction } from '../actions';

interface RestaurantProfileClientProps {
  restaurant: {
    name: string;
    description?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    timezone?: string;
    currency?: string;
    seating_mode?: 'SIMPLE' | 'STRICT';
    takeaway_enabled?: boolean;
    dine_in_customer_ordering_enabled?: boolean;
    dine_in_staff_ordering_enabled?: boolean;
    takeaway_customer_ordering_enabled?: boolean;
    takeaway_staff_ordering_enabled?: boolean;
  };
}

export default function RestaurantProfileClient({ restaurant }: RestaurantProfileClientProps) {
  const [state, formAction, isPending] = useActionState(updateProfileFormAction, null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [currentMode, setCurrentMode] = useState<'SIMPLE' | 'STRICT'>(restaurant.seating_mode || 'SIMPLE');
  const [takeawayEnabled, setTakeawayEnabled] = useState<boolean>(Boolean(restaurant.takeaway_enabled));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('updated') === 'true') {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/dashboard" className="text-xs text-emerald-400 hover:underline">
          &larr; Back to Dashboard
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold text-white">Restaurant Profile & Settings</h1>
        <p className="text-sm text-slate-400">Manage venue contact information, operational settings, and seating system mode</p>
      </div>

      {showSuccess && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400">
          ✓ Restaurant profile, takeaway settings &amp; seating mode successfully updated.
        </div>
      )}

      {state?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400">
          {state.error}
        </div>
      )}

      <form action={formAction} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-5 shadow-xl">
        {/* SEATING SYSTEM MODE TOGGLE — PROMINENT */}
        <div className="rounded-2xl border border-emerald-500/30 bg-slate-950/80 p-5 space-y-3 shadow-inner">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                Seating Engine Configuration
              </span>
              <h3 className="text-sm font-bold text-white mt-0.5">Seating System Mode</h3>
            </div>
            <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
              currentMode === 'STRICT'
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            }`}>
              Active: {currentMode}
            </span>
          </div>
          
          <p className="text-xs text-slate-400 leading-relaxed">
            Choose how tables are recommended and allocated to arriving queue parties:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <label 
              className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                currentMode === 'SIMPLE'
                  ? 'bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                  : 'bg-[#111827] border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="seating_mode"
                value="SIMPLE"
                checked={currentMode === 'SIMPLE'}
                onChange={() => setCurrentMode('SIMPLE')}
                className="mt-1 text-emerald-500 focus:ring-0 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-white block">Simple Seating</span>
                <span className="text-[11px] text-slate-400 block mt-1 leading-snug">
                  Exclusive tables only. Never shares tables between independent parties. Best for fine dining or private dining setups.
                </span>
              </div>
            </label>

            <label 
              className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                currentMode === 'STRICT'
                  ? 'bg-purple-500/10 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                  : 'bg-[#111827] border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="seating_mode"
                value="STRICT"
                checked={currentMode === 'STRICT'}
                onChange={() => setCurrentMode('STRICT')}
                className="mt-1 text-purple-500 focus:ring-0 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-white block">Strict Seating (Shared Tables)</span>
                <span className="text-[11px] text-slate-400 block mt-1 leading-snug">
                  High capacity utilization. Allows sharing free seats on large tables with multiple queue parties.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* TAKEAWAY SERVICE SETTINGS */}
        <div className="rounded-2xl border border-blue-500/30 bg-slate-950/80 p-5 space-y-3 shadow-inner">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
                Service Channels
              </span>
              <h3 className="text-sm font-bold text-white mt-0.5">TAKEAWAY</h3>
            </div>
            <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
              takeawayEnabled
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                : 'bg-slate-700/30 text-slate-400 border-slate-700/50'
            }`}>
              {takeawayEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          
          <p className="text-xs text-slate-400 leading-relaxed">
            Allow customers to join the takeaway queue and order for pickup.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <label 
              className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                takeawayEnabled
                  ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                  : 'bg-[#111827] border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="takeaway_enabled"
                value="true"
                checked={takeawayEnabled}
                onChange={() => setTakeawayEnabled(true)}
                className="mt-1 text-blue-500 focus:ring-0 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-white block">Enabled</span>
                <span className="text-[11px] text-slate-400 block mt-1 leading-snug">
                  Customers can scan venue QR to join the takeaway queue, browse menu, and collect at counter.
                </span>
              </div>
            </label>

            <label 
              className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                !takeawayEnabled
                  ? 'bg-slate-800/40 border-slate-600/50'
                  : 'bg-[#111827] border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="takeaway_enabled"
                value="false"
                checked={!takeawayEnabled}
                onChange={() => setTakeawayEnabled(false)}
                className="mt-1 text-slate-500 focus:ring-0 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-white block">Disabled</span>
                <span className="text-[11px] text-slate-400 block mt-1 leading-snug">
                  Venue offers Dine-In only. Takeaway queue joining is rejected server-side and hidden on QR.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* ORDERING CAPABILITIES CONFIGURATION */}
        <div className="rounded-2xl border border-blue-500/30 bg-slate-950/80 p-5 space-y-4 shadow-inner">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
              Ordering Module Permissions
            </span>
            <h3 className="text-sm font-bold text-white mt-0.5">Outlet Ordering Capabilities</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Enable or disable customer self-ordering and staff counter ordering independently for each service. Queue joining functions independently of whether ordering is enabled.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Dine-In Ordering */}
            <div className="rounded-xl border border-white/10 bg-[#111827] p-4 space-y-3">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>🍽️</span>
                <span>Dine-In Ordering</span>
              </span>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    name="dine_in_customer_ordering_enabled"
                    value="true"
                    defaultChecked={restaurant.dine_in_customer_ordering_enabled ?? true}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Customer Self-Ordering from Menu</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    name="dine_in_staff_ordering_enabled"
                    value="true"
                    defaultChecked={restaurant.dine_in_staff_ordering_enabled ?? true}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Staff Counter / Table Ordering</span>
                </label>
              </div>
            </div>

            {/* Takeaway Ordering */}
            <div className="rounded-xl border border-white/10 bg-[#111827] p-4 space-y-3">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>🛍️</span>
                <span>Takeaway Ordering</span>
              </span>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    name="takeaway_customer_ordering_enabled"
                    value="true"
                    defaultChecked={restaurant.takeaway_customer_ordering_enabled ?? true}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Customer Self-Ordering from Menu</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    name="takeaway_staff_ordering_enabled"
                    value="true"
                    defaultChecked={restaurant.takeaway_staff_ordering_enabled ?? true}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Staff Counter Ordering at Pickup</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Basic Details */}
        <div className="space-y-4 pt-2">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Venue Information</h4>
          
          <div>
            <label className="block text-xs font-medium text-slate-300">Restaurant Name *</label>
            <input
              type="text"
              name="name"
              required
              defaultValue={restaurant.name}
              placeholder="Restaurant Name"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Description</label>
            <textarea
              name="description"
              rows={3}
              defaultValue={restaurant.description || ''}
              placeholder="Brief description for customers..."
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">Phone</label>
              <input
                type="text"
                name="phone"
                defaultValue={restaurant.phone || ''}
                placeholder="+15550001111"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Email</label>
              <input
                type="email"
                name="email"
                defaultValue={restaurant.email || ''}
                placeholder="contact@restaurant.com"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Address</label>
            <input
              type="text"
              name="address"
              defaultValue={restaurant.address || ''}
              placeholder="123 Street Address"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300">City</label>
              <input
                type="text"
                name="city"
                defaultValue={restaurant.city || ''}
                placeholder="City"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">State</label>
              <input
                type="text"
                name="state"
                defaultValue={restaurant.state || ''}
                placeholder="State"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Country</label>
              <input
                type="text"
                name="country"
                defaultValue={restaurant.country || ''}
                placeholder="Country"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Timezone</label>
              <input
                type="text"
                name="timezone"
                defaultValue={restaurant.timezone || 'UTC'}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Currency</label>
              <input
                type="text"
                name="currency"
                defaultValue={restaurant.currency || 'USD'}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-lg transition-all hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}

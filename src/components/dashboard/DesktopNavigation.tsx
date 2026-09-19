"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';

interface DesktopNavigationProps {
  activeQueueCount: number;
  children: React.ReactNode;
}

export default function DesktopNavigation({ activeQueueCount, children }: DesktopNavigationProps) {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(path);
  };

  const navLinkClass = (path: string) => {
    if (isActive(path)) {
      return "flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#111827] border border-white/10 text-white shadow-[0_0_15px_rgba(37,99,235,0.15)] transition-colors relative overflow-hidden group";
    }
    return "flex items-center justify-between px-3 py-2.5 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition-colors";
  };

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-screen w-64 bg-[#0A0E17] border-r border-white/5 z-50 flex-col justify-between overflow-y-auto font-sans text-slate-300">
      <div className="flex flex-col">
        {/* Logo Area */}
        <div className="h-20 px-6 flex flex-col justify-center border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px] text-primary">restaurant</span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline-sm text-[16px] text-white font-black tracking-tight leading-none">QueueFlow</span>
              <span className="text-[8px] text-slate-400 font-mono tracking-widest uppercase mt-0.5">COMMAND OS • HOST STATION</span>
            </div>
          </div>
        </div>
        
        <div className="px-4 pt-6">
          <div className="mb-2 px-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Core Command</span>
          </div>
          <nav className="flex flex-col gap-1">
            <Link href="/dashboard" className={navLinkClass('/dashboard')}>
              {isActive('/dashboard') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard') ? 'text-primary' : ''}`}>grid_view</span>
                <span className="font-medium text-sm">Dashboard</span>
              </div>
              {isActive('/dashboard') && <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>}
            </Link>

            <Link href="/dashboard/queue" className={navLinkClass('/dashboard/queue')}>
              {isActive('/dashboard/queue') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/queue') ? 'text-primary' : ''}`}>people</span>
                <span className="font-medium text-sm">Live Queue</span>
              </div>
              {activeQueueCount > 0 && <span className="px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary font-mono text-[10px] font-bold">{activeQueueCount}</span>}
            </Link>
            
            <Link href="/dashboard/tables" className={navLinkClass('/dashboard/tables')}>
              {isActive('/dashboard/tables') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/tables') ? 'text-primary' : ''}`}>table_restaurant</span>
                <span className="font-medium text-sm">Tables Map</span>
              </div>
            </Link>
            
            <Link href="/dashboard/orders" className={navLinkClass('/dashboard/orders')}>
              {isActive('/dashboard/orders') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/orders') ? 'text-primary' : ''}`}>receipt_long</span>
                <span className="font-medium text-sm">Orders</span>
              </div>
            </Link>
            
            <Link href="/dashboard/kitchen" className={navLinkClass('/dashboard/kitchen')}>
              {isActive('/dashboard/kitchen') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/kitchen') ? 'text-primary' : ''}`}>soup_kitchen</span>
                <span className="font-medium text-sm">Kitchen Display</span>
              </div>
            </Link>
          </nav>

          <div className="mt-8 mb-2 px-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Venue Control</span>
          </div>
          <nav className="flex flex-col gap-1">
            <Link href="/dashboard/menu" className={navLinkClass('/dashboard/menu')}>
              {isActive('/dashboard/menu') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/menu') ? 'text-primary' : ''}`}>menu_book</span>
                <span className="font-medium text-sm">Menu Config</span>
              </div>
            </Link>

            <Link href="/dashboard/staff" className={navLinkClass('/dashboard/staff')}>
              {isActive('/dashboard/staff') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/staff') ? 'text-primary' : ''}`}>badge</span>
                <span className="font-medium text-sm">Staff Management</span>
              </div>
            </Link>
            <Link href="/dashboard/settings/qr" className={navLinkClass('/dashboard/settings/qr')}>
              {isActive('/dashboard/settings/qr') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/settings/qr') ? 'text-primary' : ''}`}>qr_code</span>
                <span className="font-medium text-sm">QR Codes</span>
              </div>
            </Link>

            <Link href="/dashboard/settings/theme" className={navLinkClass('/dashboard/settings/theme')}>
              {isActive('/dashboard/settings/theme') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/settings/theme') ? 'text-primary' : ''}`}>palette</span>
                <span className="font-medium text-sm">Customer Theme</span>
              </div>
            </Link>

            <Link href="/dashboard/profile" className={navLinkClass('/dashboard/profile')}>
              {isActive('/dashboard/profile') && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>}
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isActive('/dashboard/profile') ? 'text-primary' : ''}`}>tune</span>
                <span className="font-medium text-sm">Venue Settings</span>
              </div>
            </Link>
          </nav>
        </div>
      </div>
      <div className="p-4 flex flex-col gap-2 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Theme</span>
          <ThemeToggle />
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary text-white flex items-center justify-center font-bold text-sm">
              M
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-xs text-white truncate max-w-[100px]">
                Chef Marco
              </span>
              <span className="text-[10px] text-slate-400">Host Station 1</span>
            </div>
          </div>
          <div className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[9px] font-bold uppercase">
            Open
          </div>
        </div>
        {children}
      </div>
    </aside>
  );
}

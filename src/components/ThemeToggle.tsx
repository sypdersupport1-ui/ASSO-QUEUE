'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const saved = localStorage.getItem('queueflow-theme') as 'dark' | 'light' | null;
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const initial = saved || (prefersLight ? 'light' : 'dark');
    setTheme(initial);
    document.documentElement.classList.toggle('light', initial === 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('queueflow-theme', next);
    document.documentElement.classList.toggle('light', next === 'light');
  };

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all active:scale-95 shrink-0 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-amber-300 hover:bg-white/10 hover:text-amber-200' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-white'} ${className}`}
    >
      <span className="material-symbols-outlined text-[18px]">
        {theme === 'dark' ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  );
}

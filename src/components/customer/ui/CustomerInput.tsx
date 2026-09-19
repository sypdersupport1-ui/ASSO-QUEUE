import React from 'react';

interface CustomerInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  error?: string;
  icon?: React.ReactNode;
  required?: boolean;
  hint?: string;
}

/**
 * Reusable CustomerInput primitive.
 * Touch-friendly height, accessible error state, crisp focus ring,
 * and icon slot. Prevents mobile iOS viewport zoom with >=16px text on small screens.
 */
export function CustomerInput({
  label,
  id,
  error,
  icon,
  required,
  hint,
  className = '',
  disabled,
  ...props
}: CustomerInputProps) {
  return (
    <div className="space-y-1.5 text-left">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wider text-slate-300">
          {label} {required && <span aria-hidden="true" className="text-emerald-400">*</span>}
        </label>
        {hint && <span className="text-[11px] text-slate-500 font-normal">{hint}</span>}
      </div>

      <div className="relative">
        {icon && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {icon}
          </div>
        )}
        <input
          id={id}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-12 w-full rounded-2xl border bg-[#0e1420] text-[15px] sm:text-sm text-white placeholder-slate-500 transition-all focus:outline-none ${
            icon ? 'pl-10' : 'pl-4'
          } pr-4 ${
            error
              ? 'border-rose-500/80 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
              : 'border-[var(--qf-border)] focus:border-[var(--qf-primary)] focus:ring-2 focus:ring-emerald-500/20'
          } disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
          {...props}
        />
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-semibold text-rose-300 pl-1">
          {error}
        </p>
      )}
    </div>
  );
}

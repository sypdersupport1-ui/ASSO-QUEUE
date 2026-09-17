'use client';

import { useActionState, useState } from 'react';
import { deleteRestaurantAction } from './actions';

type State = { success: boolean; error: string } | null;

/**
 * Two-step type-to-confirm delete. Collapsed by default; expanding requires
 * typing the exact slug, which the server re-validates before deleting.
 */
export default function DeleteRestaurantForm({
  restaurantId,
  slug,
  name,
  compact = false,
}: {
  restaurantId: string;
  slug: string;
  name: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const bound = deleteRestaurantAction.bind(null, restaurantId);
  const [state, formAction, isPending] = useActionState<State, FormData>(bound as never, null);
  const matches = confirm.trim().toLowerCase() === slug.toLowerCase();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? 'rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/20'
            : 'rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20'
        }
      >
        Delete
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className={
        compact
          ? 'flex items-center gap-1.5'
          : 'rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3'
      }
    >
      {!compact && (
        <div className="text-xs text-slate-300">
          <span className="font-bold text-red-400">Permanently delete “{name}”?</span>
          <span className="mt-1 block text-slate-400">
            Queues, orders, menu, tables, memberships and history are removed. Staff login accounts are kept.
            Type <code className="font-mono text-red-300">{slug}</code> to confirm.
          </span>
        </div>
      )}
      <input type="hidden" name="confirmSlug" value={confirm} />
      <input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={slug}
        aria-label="Type restaurant slug to confirm deletion"
        className="w-full rounded-lg border border-red-500/30 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-red-400 focus:outline-none sm:w-48"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending || !matches}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Deleting…' : 'Confirm delete'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirm('');
          }}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
        >
          Cancel
        </button>
      </div>
      {state?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] font-medium text-red-400">
          {state.error}
        </div>
      )}
    </form>
  );
}

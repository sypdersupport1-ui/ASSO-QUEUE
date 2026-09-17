/**
 * Phase 5A — dashboard attention ordering (pure, dependency-free).
 *
 * Mirrors the canonical Needs-Attention ordering used by the queue
 * management screen: overdue CALLED first, then CALLED, then NOTIFIED,
 * then WAITING (oldest first). Terminal and SEATED entries never qualify.
 * Presentation helper only — all mutations stay in atomic services.
 */

export interface AttentionEntry {
  id: string;
  status: string;
  customer_name?: string | null;
  party_size?: number | null;
  display_number?: string | null;
  queue_number?: number | null;
  joined_at?: string | null;
  created_at?: string | null;
  called_at?: string | null;
}

export function isOverdueCalled(
  entry: AttentionEntry,
  callTimeoutMinutes: number,
  nowMs = Date.now()
): boolean {
  if (entry.status !== 'CALLED' || !entry.called_at) return false;
  const timeoutMs = Math.max(1, callTimeoutMinutes) * 60 * 1000;
  return nowMs - new Date(entry.called_at).getTime() > timeoutMs;
}

/**
 * Order attention candidates by operational importance. Returns at most
 * `limit` entries (default 5). Stable for equal ranks (earliest joined first).
 */
export function orderAttentionEntries(
  entries: AttentionEntry[],
  callTimeoutMinutes: number,
  limit = 5,
  nowMs = Date.now()
): AttentionEntry[] {
  const rankOf = (status: string): number => {
    if (status === 'CALLED') return 0;
    if (status === 'NOTIFIED') return 1;
    if (status === 'WAITING') return 2;
    return 9;
  };
  const joinedMs = (e: AttentionEntry): number => {
    const t = e.joined_at || e.created_at;
    const ms = t ? new Date(t).getTime() : 0;
    return Number.isNaN(ms) ? 0 : ms;
  };
  return [...entries]
    .filter((e) => ['CALLED', 'NOTIFIED', 'WAITING'].includes(e.status))
    .sort((a, b) => {
      const overdueA = isOverdueCalled(a, callTimeoutMinutes, nowMs) ? 0 : 1;
      const overdueB = isOverdueCalled(b, callTimeoutMinutes, nowMs) ? 0 : 1;
      if (overdueA !== overdueB) return overdueA - overdueB;
      const ra = rankOf(a.status);
      const rb = rankOf(b.status);
      if (ra !== rb) return ra - rb;
      return joinedMs(a) - joinedMs(b);
    })
    .slice(0, Math.max(0, limit));
}

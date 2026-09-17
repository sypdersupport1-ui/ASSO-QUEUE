'use client';

import { useEffect, useRef } from 'react';
import { syncTicketCookieAction } from '@/app/q/actions';

/**
 * Phase 3D — persists the validated ticket into the server-managed
 * HttpOnly cookie (once per visit). Replaces raw tokens in
 * localStorage / JS-readable cookies. Fire-and-forget: cookie sync
 * must never block rendering or break the page on failure.
 */
export function TicketCookieSync({
  slug,
  token,
  isTerminal,
}: {
  slug: string;
  token: string;
  isTerminal?: boolean;
}) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    syncTicketCookieAction(slug, token, isTerminal ?? false).catch(() => {});
  }, [slug, token, isTerminal]);

  return null;
}

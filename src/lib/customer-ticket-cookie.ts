import 'server-only';
import { cookies } from 'next/headers';

/**
 * Phase 3D — server-managed customer ticket cookie.
 *
 * Replaces raw bearer tokens in localStorage / JS-readable cookies.
 * The cookie is:
 *  - HttpOnly (never JS-readable, never in localStorage/sessionStorage)
 *  - SameSite=Lax, Secure in production
 *  - Path-scoped to /q/<slug> (never sent to /api or other restaurants)
 *  - Short-lived (24h) and cleared when the ticket reaches a terminal state
 *  - Per-restaurant (cookie name carries the sanitized slug)
 *
 * The value is the customer's own bearer token. Storing it HttpOnly and
 * path-scoped is the standard safer-session pattern: it removes the token
 * from JS storage, history-independent resume, bookmarks, and Referer
 * exposure for navigations that do not need the token in the URL.
 */

/**
 * Sanitized HttpOnly cookie name for a restaurant slug. Returns null for
 * anything outside [a-z0-9-]{1,64} so attacker-controlled slugs can never
 * inject cookie names, paths, or attributes. Pure function — unit tested.
 */
export function ticketCookieName(slug: string): string | null {
  if (!slug || typeof slug !== 'string') return null;
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(clean)) return null;
  return `qf_t_${clean}`;
}

function cookieNameForSlug(slug: string): string | null {
  return ticketCookieName(slug);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Persist the ticket token HttpOnly after a validated token-URL visit. */
export async function setTicketCookie(slug: string, token: string): Promise<boolean> {
  const name = cookieNameForSlug(slug);
  if (!name || !token || typeof token !== 'string') return false;
  const store = await cookies();
  store.set(name, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: `/q/${slug.trim().toLowerCase()}`,
    maxAge: 86400,
  });
  return true;
}

/** Remove the ticket cookie (terminal tickets, invalid tokens, dismissal, quit queue). */
export async function clearTicketCookie(slug: string): Promise<void> {
  const name = cookieNameForSlug(slug);
  if (!name) return;
  const cleanSlug = slug.trim().toLowerCase();
  const store = await cookies();

  try {
    store.delete(name);
  } catch {}

  try {
    store.delete({
      name,
      path: `/q/${cleanSlug}`,
    });
  } catch {}

  // Explicitly expire the cookie at the EXACT path it was created with
  store.set(name, '', {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: `/q/${cleanSlug}`,
    maxAge: 0,
    expires: new Date(0),
  });
}

/** Read the ticket token server-side (resume flows). Never exposed to JS. */
export async function getTicketToken(slug: string): Promise<string | null> {
  const name = cookieNameForSlug(slug);
  if (!name) return null;
  const store = await cookies();
  const value = store.get(name)?.value;
  if (!value || typeof value !== 'string' || value.length > 256) return null;
  return value;
}

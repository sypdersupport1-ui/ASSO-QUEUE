import 'server-only';
import { cache } from 'react';
import { createServerClient } from '@/lib/db/supabase/server';
import { AuthenticationError } from '@/lib/errors';
import type { User, Session } from '@supabase/supabase-js';

/**
 * Retrieve current active session from Supabase server client.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createServerClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    return null;
  }
  return session;
}

/**
 * Retrieve currently authenticated user from Supabase server client.
 * Wrapped with React cache() so the Supabase auth.getUser() network call is
 * deduplicated — no matter how many services call this in one request, the
 * DB is only hit once.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }
  return user;
});

/**
 * Enforce authentication. Throws AuthenticationError if user is not logged in.
 * Benefits from getUser() cache — no extra DB call if getUser() was already called.
 */
export async function requireAuth(): Promise<User> {
  const user = await getUser();
  if (!user) {
    throw new AuthenticationError('User is not authenticated');
  }
  return user;
}

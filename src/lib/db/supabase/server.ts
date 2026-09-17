import 'server-only';
import { createServerClient as createSupabaseServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/config/env';

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Creates a server-side Supabase client with cookie access for Server Components,
 * Server Actions, and Route Handlers.
 * Protected by 'server-only' to prevent client bundle leak.
 */
export async function createServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();

  return createSupabaseServerClient(
    env.public.NEXT_PUBLIC_SUPABASE_URL,
    env.public.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if middleware is refreshing user sessions.
          }
        },
      },
    }
  );
}

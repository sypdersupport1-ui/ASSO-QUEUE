import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createSupabaseBrowserClient> | null = null;

/**
 * Creates a browser-side Supabase client for client components.
 * Uses NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  if (typeof window === 'undefined') {
    return createSupabaseBrowserClient(url, anonKey);
  }

  if (!client) {
    client = createSupabaseBrowserClient(url, anonKey);
  }
  return client;
}

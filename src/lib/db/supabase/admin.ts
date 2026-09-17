import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@/lib/config/env';

/**
 * PRIVILEGED SERVICE-ROLE SUPABASE CLIENT.
 *
 * CRITICAL ARCHITECTURE & SECURITY RULES:
 * 1. This client is protected by 'server-only' and MUST NEVER be imported into or bundled for client components.
 * 2. This client bypasses Row Level Security (RLS).
 * 3. DO NOT use this client as a shortcut for normal tenant or authenticated user operations.
 * 4. Normal application features MUST use `createServerClient()` which enforces RLS policies.
 * 5. This client is reserved strictly for privileged platform operations (e.g. system provisioning, background workers).
 *
 * PERFORMANCE: Module-level singleton — the client is created once per process and reused
 * across all requests. The admin client has no per-request state (persistSession: false,
 * autoRefreshToken: false), making this completely safe.
 */
let _adminClient: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (_adminClient) {
    return _adminClient;
  }

  const env = getEnv();

  if (!env.server.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required to initialize the admin client.'
    );
  }

  _adminClient = createClient(
    env.public.NEXT_PUBLIC_SUPABASE_URL,
    env.server.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return _adminClient;
}

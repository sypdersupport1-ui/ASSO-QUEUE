import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/db/supabase/server';
import { resolveSafeRedirect } from '@/lib/services/staff-invitation-service';
import { logger } from '@/lib/logging/logger';

/**
 * Phase 3C — Supabase Auth callback for invitation / recovery links.
 *
 * Handles BOTH link formats Supabase may emit:
 *  - PKCE `code`            -> exchangeCodeForSession(code)
 *  - `token_hash` + `type`  -> verifyOtp({ token_hash, type })
 *    (invite, recovery, magiclink, email_change, signup)
 *
 * The `next` destination is allowlisted inside resolveSafeRedirect —
 * arbitrary external redirects (e.g. ?next=https://attacker.com) are
 * rejected and fall back to /auth/accept-invitation.
 *
 * No tokens, passwords, or Auth internals are ever logged here.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const next = resolveSafeRedirect(searchParams.get('next'));

  const fail = (reason: string) => {
    logger.warn('Auth confirm failed', {
      operation: 'auth_confirm',
      metadata: { reason },
    });
    const url = new URL('/auth/accept-invitation', request.url);
    url.searchParams.set('error', reason);
    return NextResponse.redirect(url);
  };

  try {
    const supabase = await createServerClient();

    const code = searchParams.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return fail('expired');
      return NextResponse.redirect(new URL(next, request.url));
    }

    const tokenHash = searchParams.get('token_hash');
    const typeParam = searchParams.get('type');
    if (tokenHash && typeParam) {
      const allowedTypes = new Set([
        'invite',
        'recovery',
        'magiclink',
        'email_change',
        'signup',
      ]);
      if (!allowedTypes.has(typeParam)) return fail('invalid');
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: typeParam as
          | 'invite'
          | 'recovery'
          | 'magiclink'
          | 'email_change'
          | 'signup',
      });
      if (error) return fail('expired');
      return NextResponse.redirect(new URL(next, request.url));
    }

    return fail('invalid');
  } catch {
    return fail('invalid');
  }
}

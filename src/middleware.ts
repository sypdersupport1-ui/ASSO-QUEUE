import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Next.js Edge Middleware.
 *
 * PERFORMANCE DESIGN:
 * - Only one DB call per request: supabase.auth.getUser() for session refresh.
 * - The previous restaurant_memberships query on /dashboard/* has been removed.
 *   Role/permission enforcement is handled inside each service via getAuthorizedRestaurantContext()
 *   and AuthorizationService.requirePermission(), which are memoized with React cache().
 *   This eliminates a redundant DB round-trip on every single page navigation.
 * - For /platform/* routes, the is_super_admin RPC remains because platform access
 *   is not validated in the service layer (it's a super-admin only route with no page-level guard).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // 1. Request Correlation ID generation and propagation
  const existingCorrelationId = request.headers.get('x-correlation-id');
  const correlationId = existingCorrelationId || crypto.randomUUID();
  response.headers.set('x-correlation-id', correlationId);

  // 1b. Phase 3D baseline security headers.
  // Referrer-Policy: customer ticket URLs carry bearer tokens — a Referer
  // must never leak them to third parties (or anywhere at all).
  // X-Content-Type-Options: blocks MIME-sniffing XSS vectors.
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // 2. Supabase Auth Session Refreshing (required by @supabase/ssr to keep tokens fresh)
  // Phase 3E: fail fast on unconfigured credentials in production instead of
  // silently running against placeholder values.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (
    process.env.NODE_ENV === 'production' &&
    (!supabaseUrl ||
      !supabaseAnonKey ||
      supabaseUrl.includes('placeholder') ||
      supabaseAnonKey.includes('placeholder'))
  ) {
    return new NextResponse('Service configuration error.', { status: 500 });
  }

  // Non-production keeps the historical placeholder fallback for local/dev.
  const supabase = createServerClient(supabaseUrl || 'https://placeholder-project.supabase.co', supabaseAnonKey || 'placeholder-anon-key', {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Single auth call — Supabase SSR caches this internally within the request
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // 3. Platform Super Admin Route Guards (/platform/*)
  if (pathname.startsWith('/platform')) {
    if (!user) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(redirectUrl);
    }

    // Platform routes require a specific super-admin check at the edge
    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', {
      p_user_id: user.id,
    });

    if (!isSuperAdmin) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'Unauthorized');
      return NextResponse.redirect(redirectUrl);
    }
  }

  // 4. Restaurant Dashboard Route Guards (/dashboard/*)
  // Authentication-only check: verifies the user is logged in.
  // Role/permission enforcement is handled inside each page and service
  // (getAuthorizedRestaurantContext + AuthorizationService), eliminating the
  // need for a restaurant_memberships DB query on every navigation.
  if (pathname.startsWith('/dashboard')) {
    if (!user) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

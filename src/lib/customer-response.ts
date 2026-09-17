import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Phase 3D — JSON responses for bearer-token-authenticated customer endpoints.
 *
 * Customer-specific payloads must never sit in shared/public caches:
 * every response carries `Cache-Control: private, no-store`. Rate-limit
 * headers passed via `headers` are preserved untouched.
 */
export function customerJson(
  data: unknown,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  const response = NextResponse.json(data, { status });
  response.headers.set('Cache-Control', 'private, no-store');
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

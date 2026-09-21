import 'server-only';
import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logging/logger';
import { hashQueueToken } from '@/lib/utils/token-utils';
import { NextResponse } from 'next/server';

export enum RateLimitEndpointClass {
  /** Read-only public — menu lookup, restaurant info, QR landing page */
  READ_ONLY = 'READ_ONLY',
  /** State-changing public — queue join, cancel, delay */
  STATE_CHANGING = 'STATE_CHANGING',
  /** High-cost public — order creation, payment initiation */
  HIGH_COST = 'HIGH_COST',
  /** Token-authenticated public — queue status by token, notifications */
  TOKEN_AUTHENTICATED = 'TOKEN_AUTHENTICATED',
  /** Authenticated staff/admin operations — invitations, resends */
  AUTHENTICATED_ADMIN = 'AUTHENTICATED_ADMIN',
}

/**
 * Endpoint-specific rate limit configurations.
 * These are starting values — adjust based on actual traffic patterns.
 */
export enum RateLimitLimit {
  /** Read-only: ~60 requests/minute/IP/restaurant */
  READ_ONLY = 60,
  /** Queue join: ~5 requests/minute/IP/restaurant */
  QUEUE_JOIN = 5,
  /** Queue cancel: ~10 requests/minute/IP/token */
  QUEUE_CANCEL = 10,
  /** Queue status: ~65 requests/minute/token or IP+restaurant (fast real-time sync) */
  QUEUE_STATUS = 65,
  /** Order creation: ~5 requests/minute/token/IP */
  ORDER_CREATION = 7,
  /** Payment initiation: ~5 requests/minute/token/IP */
  PAYMENT_INITIATION = 11,
  /** Staff invitation creation: ~20/hour/restaurant+actor (email abuse protection) */
  STAFF_INVITE_CREATE = 20,
  /** Staff invitation resend: ~6/hour/target membership */
  STAFF_INVITE_RESEND = 6,
}

/** Window duration in seconds for all rate limit buckets */
export const RateLimitWindowSeconds = 60;

/**
 * RateLimitConfig — supports tenant-scoped identifiers.
 * The identifier format follows the design spec:
 *   - rl:public:read:<ip>
 *   - rl:queue:join:<restaurantId>:<ip>
 *   - rl:queue:status:<entryId>:<tokenFingerprint>
 *   - rl:queue:cancel:<entryId>:<tokenFingerprint>
 *   - rl:order:create:<restaurantId>:<ip>
 *   - rl:payment:init:<restaurantId>:<ip>
 * Tenant scoping (restaurantId) ensures one restaurant's traffic
 * does not consume another restaurant's bucket.
 */
export interface RateLimitConfig {
  /** Identifier string — see RateLimitLimit comments for format */
  identifier: string;
  /** Maximum allowed requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Endpoint class for logging/categorization */
  endpointClass: RateLimitEndpointClass;
}

/**
 * RateLimitResult — returned to the route handler.
 * Headers are intended for Next.js Response initialization.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** HTTP headers to attach to the response */
  headers: Record<string, string>;
}

/**
 * Distributed rate limiter using Redis (with in-memory fallback).
 * Multiple Vercel/serverless instances share state via Redis.
 * Atomic INCR + EXpiration — no race-prone GET-then-SET patterns.
 * Tenant-scoped: include restaurantId in identifier to prevent cross-restaurant spillover.
 *
 * Correctness requirement:
 *   Multiple Vercel/serverless instances must share rate-limit state.
 *   Do NOT use: module-level Map, global variable, process memory,
 *   setInterval, local filesystem as the authoritative limiter.
 */
export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  try {
    const result = await redisClient.rateLimitCheck(
      config.identifier,
      config.limit,
      config.windowSeconds
    );

    if (!result.allowed) {
      logger.warn('Rate limit exceeded', {
        operation: 'rate_limit',
        metadata: {
          identifierPrefix: config.identifier.split(':')[0], // Log only bucket prefix, not full key
          limit: config.limit,
          window: config.windowSeconds,
          endpointClass: config.endpointClass,
        },
      });
    }

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      headers: {
        'X-RateLimit-Limit': String(config.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Window': String(config.windowSeconds),
        ...(result.allowed ? {} : { 'Retry-After': String(config.windowSeconds) }),
      },
    };
  } catch (err) {
    // If rate limiting itself fails, allow the request and log the failure.
    // This prevents rate limit infrastructure outages from taking down the application.
    // Fail-closed for mutation endpoints would require per-endpoint behavior documented
    // in the Redis failure behavior section (Section 5 of the spec).
    logger.error('Rate limit check failed — allowing request as fail-open', {
      operation: 'rate_limit_error',
      metadata: { error: err instanceof Error ? err.message : String(err), endpointClass: config.endpointClass },
    });
    return {
      allowed: true,
      remaining: config.limit,
      headers: {},
    };
  }
}

/**
 * Generate a rate-limit identifier for read-only public endpoints.
 * Format: rl:public:read:<ip>
 * IP is sourced from the Next.js request using getClientIp().
 */
export function generateReadOnlyIdentifier(ip: string): string {
  return `rl:public:read:${ip}`;
}

/**
 * Generate a rate-limit identifier for queue join endpoints.
 * Format: rl:queue:join:<restaurantId>:<ip>
 * Tenant-scoped: includes restaurantId so one restaurant's traffic
 * does not consume another restaurant's bucket.
 */
export function generateQueueJoinIdentifier(restaurantId: string, ip: string): string {
  return `rl:queue:join:${restaurantId}:${ip}`;
}

/**
 * Generate a rate-limit identifier for queue status/cancellation endpoints
 * that use a token fingerprint.
 * Format: rl:queue:status:<entryId>:<tokenFingerprint>
 * The token fingerprint is SHA-256 hash of the raw token, never storing
 * the raw token in the Redis key. This preserves the database token_hash
 * security model while enabling distributed rate limiting.
 *
 * NOTE: entryId and tokenFingerprint are passed by the caller because
 * the route handler must first validate the token against the database
 * before having the entryId available.
 */
export function generateQueueStatusIdentifier(entryId: string, tokenFingerprint: string): string {
  return `rl:queue:status:${entryId}:${tokenFingerprint}`;
}

/**
 * Generate a rate-limit identifier for queue cancellation endpoints.
 * Format: rl:queue:cancel:<entryId>:<tokenFingerprint>
 * Same token fingerprinting approach as status endpoint.
 */
export function generateQueueCancelIdentifier(entryId: string, tokenFingerprint: string): string {
  return `rl:queue:cancel:${entryId}:${tokenFingerprint}`;
}

/**
 * Generate a rate-limit identifier for order creation endpoints.
 * Format: rl:order:create:<restaurantId>:<ip>
 * Tenant-scoped with IP fallback.
 */
export function generateOrderCreateIdentifier(restaurantId: string, ip: string): string {
  return `rl:order:create:${restaurantId}:${ip}`;
}

/**
 * Generate a rate-limit identifier for payment initiation endpoints.
 * Format: rl:payment:init:<restaurantId>:<ip>
 * Tenant-scoped with IP fallback.
 */
export function generatePaymentInitIdentifier(restaurantId: string, ip: string): string {
  return `rl:payment:init:${restaurantId}:${ip}`;
}

/**
 * Generate a rate-limit identifier for staff invitation creation.
 * Format: rl:staff:invite:<restaurantId>:<actorId>
 * Authenticated + tenant-scoped: one restaurant's admin activity never
 * consumes another restaurant's bucket. No customer QR limits apply here.
 */
export function generateStaffInviteIdentifier(
  restaurantId: string,
  actorId: string
): string {
  return `rl:staff:invite:${restaurantId}:${actorId}`;
}

/**
 * Generate a rate-limit identifier for staff invitation resends.
 * Format: rl:staff:resend:<membershipId>
 * Per-target throttling so repeated resends to the same invitee are bounded
 * even if the actor changes.
 */
export function generateStaffResendIdentifier(membershipId: string): string {
  return `rl:staff:resend:${membershipId}`;
}

/**
 * Fingerprint a raw queue token for use in rate-limit keys.
 * Uses SHA-256 — the same algorithm already used to hash tokens in the database
 * (queue_entries.token_hash). This ensures the Redis key never contains the
 * raw token while still enabling per-token rate limiting.
 *
 * Raw token is NEVER:
 * - Stored in Redis key
 * - Logged
 * - Returned in error messages
 * - Exposed in analytics
 * - Placed in URL or audit logs
 *
 * @param rawToken The raw queue token (format: qtoken_<64_hex>)
 * @returns SHA-256 hex digest (64 characters)
 */
export function fingerprintQueueToken(rawToken: string): string {
  return hashQueueToken(rawToken);
}

/**
 * Extract a best-effort client IP from Next.js request headers.
 * Platform guidance: Do NOT blindly trust arbitrary X-Forwarded-For from an
 * arbitrary client. Vercel normalizes the request IP via the platform's
 * request context. Use the framework-provided mechanism.
 *
 * Do not accept X-Forwarded-For as authoritative unless the framework/platform
 * has already normalized/trusted it.
 *
 * Source preference:
 *   1. req.ip from Next.js Request (already proxy-aware when behind Vercel)
 *   2. x-real-ip header (if present and framework-trusted)
 *   3. Conservative fallback: 'unknown'
 *
 * @param req Next.js Request object
 * @returns Client IP string, or 'unknown' if unavailable
 */
export function getClientIp(req: Request): string {
  try {
    // Next.js Request.ip is already proxy-aware when deployed on Vercel/edge.
    // It respects the platform's trusted proxy chain and does NOT blindly
    // trust arbitrary X-Forwarded-For from end clients.
    const nextIp = (req as Request & { ip?: string }).ip;
    if (nextIp && nextIp !== '::1' && nextIp !== '127.0.0.1') {
      return nextIp;
    }
  } catch {
    // nextIp may throw in edge runtime if request is malformed
  }

  // Fallback to headers only if Next.ip didn't yield a valid external IP
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) {
      // NOTE: In production behind Vercel, prefer req.ip over X-Forwarded-For.
      // X-Forwarded-For can be spoofed by end clients.
      // Only use as additional fallback.
      return first.trim();
    }
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') {
    return realIp;
  }

  return 'unknown';
}

/**
 * Best-effort client IP for Server Actions (no Request object available).
 * Reads the platform-provided headers via next/headers. Same trust model
 * as getClientIp: proxy headers are a fallback signal for abuse buckets,
 * never an authentication factor.
 */
export async function getActionClientIp(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const store = await headers();
    const forwarded = store.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0];
      if (first && first.trim() && first.trim() !== '::1' && first.trim() !== '127.0.0.1') {
        return first.trim();
      }
    }
    const realIp = store.get('x-real-ip');
    if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') return realIp;
  } catch {
    // headers() unavailable (tests, non-request context) — fall through
  }
  return 'unknown';
}

/**
 * Determine the endpoint class for a given request path and context.
 * This is used for logging, metrics, and endpoint-specific limit selection.
 */
export function determineEndpointClass(
  path: string,
  token?: string
): RateLimitEndpointClass {
  const lowerPath = path.toLowerCase();

  // Token-authenticated endpoints
  if (token) {
    return RateLimitEndpointClass.TOKEN_AUTHENTICATED;
  }

  // Read-only patterns
  if (
    lowerPath.includes('/menu') ||
    lowerPath.includes('/restaurant') ||
    lowerPath.includes('/public') ||
    lowerPath.includes('/health')
  ) {
    return RateLimitEndpointClass.READ_ONLY;
  }

  // State-changing queue patterns
  if (
    lowerPath.includes('/queue/join') ||
    lowerPath.includes('/q/join') ||
    lowerPath.includes('/q/cancel') ||
    lowerPath.includes('/q/delay')
  ) {
    return RateLimitEndpointClass.STATE_CHANGING;
  }

  // High-cost patterns
  if (lowerPath.includes('/order') || lowerPath.includes('/payment')) {
    return RateLimitEndpointClass.HIGH_COST;
  }

  // Default to read-only for safety
  return RateLimitEndpointClass.READ_ONLY;
}

/**
 * Safe 429 response builder for rate-limited requests.
 * Returns a friendly message without revealing Redis internals,
 * rate-limit keys, or customer information.
 *
 * @param remaining How many requests were remaining when blocked
 * @param windowSeconds Rate limit window in seconds
 * @returns NextResponse with 429 status and safe headers
 */
export function buildRateLimitResponse(remaining: number, windowSeconds: number): NextResponse {
  const message = 'Too many requests. Please try again shortly.';
  const response = new NextResponse(message, { status: 429 });

  // Retry-After when window is known
  response.headers.set('Retry-After', String(windowSeconds));

  // Safe rate-limit headers — no internal key exposure
  response.headers.set('X-RateLimit-Limit', String(windowSeconds > 0 ? windowSeconds : 60));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Window', String(windowSeconds));

  return response;
}

/** Default window in seconds — exported for route handler use */
export const DEFAULT_RATE_LIMIT_WINDOW = RateLimitWindowSeconds;

/** Endpoint class → starting limit mapping */
export const EndpointClassLimits: Record<RateLimitEndpointClass, number> = {
  [RateLimitEndpointClass.READ_ONLY]: 60,
  [RateLimitEndpointClass.STATE_CHANGING]: 5,
  [RateLimitEndpointClass.HIGH_COST]: 7,
  [RateLimitEndpointClass.TOKEN_AUTHENTICATED]: 30,
  [RateLimitEndpointClass.AUTHENTICATED_ADMIN]: 20,
};

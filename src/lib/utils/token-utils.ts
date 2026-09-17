import crypto from 'crypto';

/**
 * Generates a cryptographically secure random bearer token for a customer queue entry.
 * Format: `qtoken_<64_hex_chars>`
 */
export function generateQueueToken(): string {
  const randomHex = crypto.randomBytes(32).toString('hex');
  return `qtoken_${randomHex}`;
}

/**
 * Computes a SHA-256 hash of the raw token for secure database lookup and storage.
 */
export function hashQueueToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Invalid raw token provided for hashing');
  }
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

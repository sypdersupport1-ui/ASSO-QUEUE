import { describe, it, expect } from 'vitest';
import {
  generateQueueToken,
  hashQueueToken,
} from '@/lib/utils/token-utils';
import { fingerprintQueueToken, getClientIp } from '@/lib/rate-limit';
import { customerJson } from '@/lib/customer-response';
import { ticketCookieName } from '@/lib/customer-ticket-cookie';

describe('Phase 3D: token generation & fingerprint invariants', () => {
  it('generates qtoken_ + 64 hex chars from cryptographic randomness', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = generateQueueToken();
      expect(t).toMatch(/^qtoken_[0-9a-f]{64}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(50);
  });

  it('hash is deterministic SHA-256 hex and avalanches on 1-char change', () => {
    const t = generateQueueToken();
    expect(hashQueueToken(t)).toBe(hashQueueToken(t));
    expect(hashQueueToken(t)).toMatch(/^[0-9a-f]{64}$/);
    const tampered = t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a');
    expect(hashQueueToken(tampered)).not.toBe(hashQueueToken(t));
  });

  it('empty/non-string input fails closed (throws) instead of hashing', () => {
    expect(() => hashQueueToken('')).toThrow();
    expect(() => hashQueueToken(null as unknown as string)).toThrow();
  });

  it('fingerprint never equals or contains the raw token', () => {
    const raw = generateQueueToken();
    const fp = fingerprintQueueToken(raw);
    expect(fp).not.toBe(raw);
    expect(fp).not.toContain(raw);
    expect(raw).not.toContain(fp);
    expect(fp).toHaveLength(64);
  });

  it('non-empty malformed input hashes without throwing (misses DB lookup)', () => {
    expect(() => hashQueueToken('   ')).not.toThrow();
    expect(() => fingerprintQueueToken('not-a-token')).not.toThrow();
    expect(hashQueueToken('not-a-token')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Phase 3D: IP handling is conservative', () => {
  const req = (headers: Record<string, string>) =>
    new Request('http://x.test/', { headers }) as Request;

  it('falls back to unknown when nothing is present', () => {
    expect(getClientIp(req({}))).toBe('unknown');
  });

  it('uses x-real-ip and ignores loopback', () => {
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(getClientIp(req({ 'x-real-ip': '127.0.0.1' }))).toBe('unknown');
  });

  it('takes the first forwarded entry only', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }))
    ).toBe('198.51.100.9');
  });
});

describe('Phase 3D: customer responses are private/no-store', () => {
  it('customerJson stamps Cache-Control and preserves headers', () => {
    const res = customerJson({ ok: true }, 200, {
      'X-RateLimit-Limit': '30',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30');
  });

  it('429 responses carry Retry-After without sensitive identifiers', async () => {
    const res = customerJson(
      { error: 'Too many requests. Please try again shortly.' },
      429,
      { 'Retry-After': '60' }
    );
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/ratelimit:|qtoken_|token_hash/i);
  });
});

describe('Phase 3E: ticket cookie names are injection-safe', () => {
  it('accepts normal slugs', () => {
    expect(ticketCookieName('spice-house')).toBe('qf_t_spice-house');
    expect(ticketCookieName('A1')).toBe('qf_t_a1');
  });

  it('rejects cookie-injection and oversized slugs', () => {
    expect(ticketCookieName('x; Path=/; HttpOnly=false')).toBeNull();
    expect(ticketCookieName('a"b')).toBeNull();
    expect(ticketCookieName('')).toBeNull();
    expect(ticketCookieName('a'.repeat(65))).toBeNull();
    expect(ticketCookieName('slug/with/slashes')).toBeNull();
    expect(ticketCookieName(null as unknown as string)).toBeNull();
  });
});

describe('Phase 3D: browser storage hygiene (regression guard)', () => {
  it('no customer component persists tokens in web storage', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve('src/components/customer');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(tsx?)$/.test(file)) continue;
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const lines = content.split('\n');
      // Phase 4G sanctioned exception: CustomerMenuBrowser may persist
      // NON-SENSITIVE cart lines in sessionStorage (spec §9). The exception
      // holds only while the file carries the documented no-token contract
      // AND its stored shape has no credential fields (checked below).
      const isSanctionedCartFile = file === 'CustomerMenuBrowser.tsx'
        && content.includes('NEVER queue/order tokens')
        && /interface CartItem \{[^}]*\}/s.test(content)
        && !(content.match(/interface CartItem \{[^}]*\}/s)?.[0] ?? '').match(/[Tt]oken|secret|cookie|password/i);
      lines.forEach((line, i) => {
        // Flag real Web Storage / cookie WRITE+READ API usage only
        // (prose mentions in comments are fine).
        if (/\blocalStorage\s*\.\s*(setItem|getItem|removeItem)/.test(line)) {
          offenders.push(`${file}:${i + 1}:${line.trim()}`);
        }
        if (/\bsessionStorage\s*\./.test(line) && !isSanctionedCartFile) {
          offenders.push(`${file}:${i + 1}:${line.trim()}`);
        }
        if (/document\.cookie\s*=/.test(line)) {
          offenders.push(`${file}:${i + 1}:${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

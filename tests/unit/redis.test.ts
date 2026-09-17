import { describe, it, expect } from 'vitest';
import { redisClient } from '@/lib/redis';

describe('Resilient Redis Abstraction', () => {
  it('should set and get cache values cleanly using fallback', async () => {
    await redisClient.set('test_key', 'test_val');
    const val = await redisClient.get('test_key');
    expect(val).toBe('test_val');
  });

  it('should support rate limit checking gracefully', async () => {
    const res1 = await redisClient.rateLimitCheck('user_123', 2, 60);
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(1);

    const res2 = await redisClient.rateLimitCheck('user_123', 2, 60);
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(0);

    const res3 = await redisClient.rateLimitCheck('user_123', 2, 60);
    expect(res3.allowed).toBe(false);
    expect(res3.remaining).toBe(0);
  });
});

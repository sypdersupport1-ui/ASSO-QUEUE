import 'server-only';
import Redis from 'ioredis';
import { getEnv } from '@/lib/config/env';
import { logger } from '@/lib/logging/logger';

export interface RedisClientInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  rateLimitCheck(
    identifier: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }>;
}

/**
 * Resilient In-Memory Fallback Client used when REDIS_URL is not configured or fails.
 * Guarantees "Postgres is truth, Redis is speed" architectural principle.
 */
class InMemoryRedisFallback implements RedisClientInterface {
  private cache = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.cache.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.cache.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  async rateLimitCheck(
    identifier: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const key = `ratelimit:${identifier}`;
    const rawCount = await this.get(key);
    const count = rawCount ? parseInt(rawCount, 10) : 0;

    if (count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    await this.set(key, (count + 1).toString(), windowSeconds);
    return { allowed: true, remaining: limit - (count + 1) };
  }
}

class ResilientRedisClient implements RedisClientInterface {
  private redis: Redis | null = null;
  private fallback: InMemoryRedisFallback = new InMemoryRedisFallback();
  private isConnected = false;

  constructor() {
    const env = getEnv();
    if (env.server.REDIS_URL) {
      try {
        this.redis = new Redis(env.server.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });

        this.redis.on('connect', () => {
          this.isConnected = true;
          logger.info('Redis connection established', { operation: 'redis_connect' });
        });

        this.redis.on('error', (err) => {
          this.isConnected = false;
          logger.warn('Redis error encountered, falling back to in-memory cache', {
            operation: 'redis_error',
            errorName: err.name,
          });
        });
      } catch (err) {
        logger.warn('Failed to initialize Redis client, using fallback', {
          operation: 'redis_init_error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.info('REDIS_URL not configured. Using resilient in-memory fallback', {
        operation: 'redis_fallback_mode',
      });
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.redis && this.isConnected) {
      try {
        return await this.redis.get(key);
      } catch {
        // Fallback gracefully on query error
      }
    }
    return this.fallback.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (this.redis && this.isConnected) {
      try {
        if (ttlSeconds) {
          return await this.redis.set(key, value, 'EX', ttlSeconds);
        }
        return await this.redis.set(key, value);
      } catch {
        // Fallback gracefully
      }
    }
    return this.fallback.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<number> {
    if (this.redis && this.isConnected) {
      try {
        return await this.redis.del(key);
      } catch {
        // Fallback gracefully
      }
    }
    return this.fallback.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (this.redis && this.isConnected) {
      try {
        const res = await this.redis.exists(key);
        return res === 1;
      } catch {
        // Fallback gracefully
      }
    }
    return this.fallback.exists(key);
  }

  async rateLimitCheck(
    identifier: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (this.redis && this.isConnected) {
      try {
        const key = `ratelimit:${identifier}`;
        const current = await this.redis.incr(key);
        if (current === 1) {
          await this.redis.expire(key, windowSeconds);
        }
        if (current > limit) {
          return { allowed: false, remaining: 0 };
        }
        return { allowed: true, remaining: limit - current };
      } catch {
        // Fallback gracefully
      }
    }
    return this.fallback.rateLimitCheck(identifier, limit, windowSeconds);
  }
}

export const redisClient: RedisClientInterface = new ResilientRedisClient();

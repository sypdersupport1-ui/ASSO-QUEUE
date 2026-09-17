import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logging/logger';

export const CacheKeys = {
  publicRestaurant: (slug: string) => `cache:public:restaurant:${slug.toLowerCase().trim()}`,
  // Room for more keys in the future
};

export class CacheService {
  /**
   * Tries to fetch data from Redis cache. If it doesn't exist, runs the fetcher function,
   * stores the result in Redis with the given TTL, and returns the result.
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T | null>,
    ttlSeconds: number = 300 // default 5 minutes
  ): Promise<T | null> {
    try {
      const cachedResult = await redisClient.get(key);
      if (cachedResult) {
        logger.debug(`Cache HIT for key: ${key}`, { operation: 'cache_hit', key });
        return JSON.parse(cachedResult) as T;
      }
    } catch (error) {
      logger.warn(`Failed to read from cache for key: ${key}`, { operation: 'cache_read_error', error, key });
      // If reading from cache fails, we swallow the error and just fetch fresh data
    }

    logger.debug(`Cache MISS for key: ${key}. Fetching fresh data...`, { operation: 'cache_miss', key });
    
    const freshData = await fetcher();
    
    // Only cache if there's actual data to cache
    if (freshData !== null && freshData !== undefined) {
      try {
        await redisClient.set(key, JSON.stringify(freshData), ttlSeconds);
      } catch (error) {
        logger.warn(`Failed to write to cache for key: ${key}`, { operation: 'cache_write_error', error, key });
      }
    }

    return freshData;
  }

  /**
   * Invalidates a specific key in the cache.
   */
  static async invalidate(key: string): Promise<void> {
    try {
      await redisClient.del(key);
      logger.debug(`Cache INVALIDATED for key: ${key}`, { operation: 'cache_invalidate', key });
    } catch (error) {
      logger.warn(`Failed to invalidate cache for key: ${key}`, { operation: 'cache_invalidate_error', error, key });
    }
  }
}

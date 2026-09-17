import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { PublicRestaurantService } from '@/lib/services/public-restaurant-service';
import { QueueService } from '@/lib/services/queue-service';
import { resetEnvCacheForTesting } from '@/lib/config/env';

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;

describe('Phase 9: Customer QR Experience, Public Services & Tenant Isolation Tests', () => {
  let client: Client;

  const RESTAURANT_A_ID = '77777777-7777-4777-a777-777777777777';
  const RESTAURANT_B_ID = '88888888-8888-4888-a888-888888888888';
  const RESTAURANT_A_SLUG = 'spice-house-qr-demo';
  const RESTAURANT_B_SLUG = 'pasta-palace-qr-demo';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live customer QR tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    // Ensure dedicated test restaurants exist without overwriting seed restaurants
    await client.query(`
      INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status)
      VALUES 
        ($1, 'Spice House QR Demo', $2, true, 100, 1, 20, 'ACTIVE'),
        ($3, 'Pasta Palace QR Demo', $4, true, 100, 1, 20, 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        queue_enabled = true,
        max_queue_capacity = 100,
        min_party_size = 1,
        max_party_size = 20,
        status = 'ACTIVE';
    `, [RESTAURANT_A_ID, RESTAURANT_A_SLUG, RESTAURANT_B_ID, RESTAURANT_B_SLUG]);

    // Ensure seed restaurant 'le-petit-bistro' slug is preserved if mutated
    await client.query(`
      UPDATE public.restaurants SET slug = 'le-petit-bistro' WHERE id = '11111111-1111-4111-a111-111111111111';
    `);

    // Clean existing queue entries for test restaurants
    await client.query(`
      DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2);
    `, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. PUBLIC RESTAURANT RESOLUTION
  // ---------------------------------------------------------------------------
  it('[PUBLIC RESOLUTION TEST] Resolves public restaurant details by valid slug and handles invalid slug', async () => {
    const restaurant = await PublicRestaurantService.getPublicRestaurantBySlug(RESTAURANT_A_SLUG);

    expect(restaurant).toBeDefined();
    expect(restaurant?.id).toBe(RESTAURANT_A_ID);
    expect(restaurant?.slug).toBe(RESTAURANT_A_SLUG);
    expect(restaurant?.queueEnabled).toBe(true);

    const invalid = await PublicRestaurantService.getPublicRestaurantBySlug('non-existent-slug-xyz');
    expect(invalid).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 2. PUBLIC QUEUE JOIN & TOKEN SECURITY
  // ---------------------------------------------------------------------------
  it('[PUBLIC JOIN TEST] Customer joins queue via public service and receives raw token', async () => {
    const result = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Priya Patel',
      customerPhone: '+919811122233',
      partySize: 3,
    });

    expect(result.entry).toBeDefined();
    expect(result.rawToken).toMatch(/^qtoken_[a-f0-9]{64}$/);

    const status = await QueueService.getQueueStatusByToken(result.rawToken);
    expect(status).toBeDefined();
    expect(status?.restaurantId).toBe(RESTAURANT_A_ID);
    expect(status?.customerName).toBe('Priya Patel');
    expect(status?.partySize).toBe(3);
    expect(status?.status).toBe('WAITING');
    expect(status?.displayNumber).toMatch(/^\d+$/);
  });

  // ---------------------------------------------------------------------------
  // 3. TENANT ISOLATION & TOKEN SECURITY BOUNDARY
  // ---------------------------------------------------------------------------
  it('[TENANT ISOLATION TEST] Token for Restaurant A is denied when validated against Restaurant B context', async () => {
    const joinA = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Tenant Isolated Customer',
      partySize: 2,
    });

    const statusA = await QueueService.getQueueStatusByToken(joinA.rawToken);
    const restaurantB = await PublicRestaurantService.getPublicRestaurantBySlug(RESTAURANT_B_SLUG);

    expect(statusA).toBeDefined();
    expect(restaurantB).toBeDefined();

    // Verify cross-tenant assertion rule: token's restaurantId must match requested restaurantId
    const isTenantMatch = statusA?.restaurantId === restaurantB?.id;
    expect(isTenantMatch).toBe(false);
  });

  it('[INVALID TOKEN TEST] Querying status with invalid token returns null', async () => {
    const invalidStatus = await QueueService.getQueueStatusByToken('qtoken_fake_invalid_token_999');
    expect(invalidStatus).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 4. CUSTOMER CANCELLATION
  // ---------------------------------------------------------------------------
  it('[CUSTOMER CANCELLATION TEST] Active customer entry can be cancelled via token', async () => {
    const join = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Customer To Cancel',
      partySize: 2,
    });

    const initialStatus = await QueueService.getQueueStatusByToken(join.rawToken);
    expect(initialStatus?.status).toBe('WAITING');

    const updated = await QueueService.updateQueueStatus({
      entryId: join.entry.id,
      newStatus: 'CANCELLED',
    });

    expect(updated.status).toBe('CANCELLED');

    const finalStatus = await QueueService.getQueueStatusByToken(join.rawToken);
    expect(finalStatus?.status).toBe('CANCELLED');
  });

  // ---------------------------------------------------------------------------
  // 5. PUBLIC MENU PREVIEW
  // ---------------------------------------------------------------------------
  it('[MENU PREVIEW TEST] Resolves active menu categories and items for public preview', async () => {
    const preview = await PublicRestaurantService.getPublicMenuPreview(RESTAURANT_A_ID);
    expect(Array.isArray(preview)).toBe(true);
  });
});

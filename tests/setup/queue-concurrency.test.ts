import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { QueueService } from '@/lib/services/queue-service';
import { hashQueueToken } from '@/lib/utils/token-utils';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 8: Core Queue Engine, FSM, Concurrency & Security Tests', () => {
  let client: Client;

  const RESTAURANT_A_ID = '11111111-1111-4111-a111-111111111111';
  const RESTAURANT_B_ID = '22222222-2222-4222-a222-222222222222';
  // Resolved by email in beforeAll: alice's Auth user was recreated
  // (new UUID) when repairing its broken seed row — never hard-rely on it.
  let ADMIN_A_ID = 'a0000000-0000-4000-a000-000000000002';
  const SUPER_ADMIN_ID = 'a0000000-0000-4000-a000-000000000001';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live queue tests');
    }
    client = new Client({ connectionString });
        await client.connect();
    try {
      const found = await client.query(`SELECT id FROM auth.users WHERE lower(email) = 'alice@bistro.com' LIMIT 1`);
      if (found.rows.length > 0) ADMIN_A_ID = found.rows[0].id;
    } catch {
      // Fall back to the seed UUID.
    }

    // Ensure test restaurants have clean default queue settings
    await client.query(`
      UPDATE public.restaurants
      SET queue_enabled = true, max_queue_capacity = 100, min_party_size = 1, max_party_size = 20
      WHERE id IN ($1, $2)
    `, [RESTAURANT_A_ID, RESTAURANT_B_ID]);

    // Clean up existing test queue entries
    await client.query(`
      DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2)
    `, [RESTAURANT_A_ID, RESTAURANT_B_ID]);
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. QUEUE JOIN & CONFIGURATION VALIDATION
  // ---------------------------------------------------------------------------
  it('[QUEUE JOIN TEST] Customer can join open queue with valid party size', async () => {
    const result = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Rahul Sharma',
      customerPhone: '+919876543210',
      partySize: 4,
    });

    expect(result.entry).toBeDefined();
    expect(result.entry.restaurant_id).toBe(RESTAURANT_A_ID);
    expect(result.entry.customer_name).toBe('Rahul Sharma');
    expect(result.entry.party_size).toBe(4);
    expect(result.entry.status).toBe('WAITING');
    expect(result.entry.display_number).toMatch(/^\d+/);
    expect(result.rawToken).toMatch(/^qtoken_[a-f0-9]{64}$/);

    // Verify raw token is NOT stored in database
    expect(result.entry.token_hash).toBe(hashQueueToken(result.rawToken));
    expect(result.entry.token_hash).not.toBe(result.rawToken);
  });

  it('[QUEUE JOIN TEST] Rejects queue join when queue is CLOSED', async () => {
    // Close queue for Restaurant B
    await QueueService.toggleQueueOpen(RESTAURANT_B_ID, false, SUPER_ADMIN_ID);

    await expect(
      QueueService.joinQueue({
        restaurantId: RESTAURANT_B_ID,
        customerName: 'Closed Queue Customer',
        customerPhone: '+919876543211',
        partySize: 2,
      })
    ).rejects.toThrow('QUEUE_CLOSED');

    // Re-open queue for Restaurant B
    await QueueService.toggleQueueOpen(RESTAURANT_B_ID, true, SUPER_ADMIN_ID);
  });

  it('[QUEUE JOIN TEST] Rejects invalid party size boundaries', async () => {
    // Party size < min_party_size (0)
    await expect(
      QueueService.joinQueue({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Invalid Party 0',
        partySize: 0,
      })
    ).rejects.toThrow();

    // Party size > max_party_size (25 when max is 20)
    await expect(
      QueueService.joinQueue({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Excessive Party',
        partySize: 25,
      })
    ).rejects.toThrow('INVALID_PARTY_SIZE');
  });

  // ---------------------------------------------------------------------------
  // 2. CAPACITY & CONCURRENCY TESTS
  // ---------------------------------------------------------------------------
  it('[CAPACITY CONCURRENCY TEST] Concurrent joins beyond max capacity enforce limit safely', async () => {
    // Set capacity to 2 on Restaurant B
    await client.query(`
      UPDATE public.restaurants SET max_queue_capacity = 2 WHERE id = $1
    `, [RESTAURANT_B_ID]);

    await client.query(`
      DELETE FROM public.queue_entries WHERE restaurant_id = $1
    `, [RESTAURANT_B_ID]);

    // Perform 3 simultaneous joins against max_queue_capacity = 2
    const promises = [
      QueueService.joinQueue({
        restaurantId: RESTAURANT_B_ID,
        customerName: 'Concurrent Customer 1',
        customerPhone: '+919000000001',
        partySize: 2,
      }),
      QueueService.joinQueue({
        restaurantId: RESTAURANT_B_ID,
        customerName: 'Concurrent Customer 2',
        customerPhone: '+919000000002',
        partySize: 2,
      }),
      QueueService.joinQueue({
        restaurantId: RESTAURANT_B_ID,
        customerName: 'Concurrent Customer 3',
        customerPhone: '+919000000003',
        partySize: 2,
      }),
    ];

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err.message).toContain('QUEUE_FULL');

    // Reset capacity to 100
    await client.query(`
      UPDATE public.restaurants SET max_queue_capacity = 100 WHERE id = $1
    `, [RESTAURANT_B_ID]);
  });

  it('[DUPLICATE JOIN CONCURRENCY TEST] Concurrent duplicate active join attempts reject safely', async () => {
    const samePhone = `+919999${Date.now().toString().slice(-6)}`;

    // Perform 2 simultaneous joins with identical phone number
    const promises = [
      QueueService.joinQueue({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Dup Customer A',
        customerPhone: samePhone,
        partySize: 2,
      }),
      QueueService.joinQueue({
        restaurantId: RESTAURANT_A_ID,
        customerName: 'Dup Customer B',
        customerPhone: samePhone,
        partySize: 2,
      }),
    ];

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err.message).toContain('DUPLICATE_ACTIVE_ENTRY');
  });

  // ---------------------------------------------------------------------------
  // 3. DYNAMIC POSITION & ORDERING TESTS
  // ---------------------------------------------------------------------------
  it('[POSITION CALCULATION TEST] Position and people ahead are calculated deterministically', async () => {
    // Clean queue entries for Restaurant A
    await client.query(`
      DELETE FROM public.queue_entries WHERE restaurant_id = $1
    `, [RESTAURANT_A_ID]);

    const join1 = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'First Party',
      partySize: 2,
    });

    const join2 = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Second Party',
      partySize: 4,
    });

    const join3 = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Third Party',
      partySize: 3,
    });

    // Check status by token
    const status1 = await QueueService.getQueueStatusByToken(join1.rawToken);
    const status2 = await QueueService.getQueueStatusByToken(join2.rawToken);
    const status3 = await QueueService.getQueueStatusByToken(join3.rawToken);

    expect(status1?.position).toBe(1);
    expect(status1?.peopleAhead).toBe(0);

    expect(status2?.position).toBe(2);
    expect(status2?.peopleAhead).toBe(1);

    expect(status3?.position).toBe(3);
    expect(status3?.peopleAhead).toBe(2);

    // Cancel First Party -> Second Party becomes position 1
    await QueueService.updateQueueStatus({
      entryId: join1.entry.id,
      newStatus: 'CANCELLED',
      actorUserId: ADMIN_A_ID,
    });

    const status2After = await QueueService.getQueueStatusByToken(join2.rawToken);
    const status3After = await QueueService.getQueueStatusByToken(join3.rawToken);

    expect(status2After?.position).toBe(1);
    expect(status2After?.peopleAhead).toBe(0);

    expect(status3After?.position).toBe(2);
    expect(status3After?.peopleAhead).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 4. FINITE STATE MACHINE (FSM) TRANSITION TESTS
  // ---------------------------------------------------------------------------
  it('[FSM STATE TRANSITION TEST] Valid transitions succeed and invalid transitions are rejected', async () => {
    const join = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'FSM Test Customer',
      partySize: 2,
    });

    // WAITING -> CALLED (Valid)
    const called = await QueueService.updateQueueStatus({
      entryId: join.entry.id,
      newStatus: 'CALLED',
      actorUserId: ADMIN_A_ID,
    });
    expect(called.status).toBe('CALLED');
    expect(called.called_at).toBeDefined();

    // CALLED -> SEATED must be via seatQueueEntry (authoritative seating), not generic update
    // First create a table for seating
    const { createAdminClient } = await import('@/lib/db/supabase/admin');
    const supabase = createAdminClient();
    const { data: table } = await supabase.from('restaurant_tables').insert({ restaurant_id: RESTAURANT_A_ID, table_number: `T-SEAT-${Date.now()}`, capacity: 4, status: 'AVAILABLE' }).select().single();
    const seated = await QueueService.seatQueueEntry(join.entry.id, table!.id, ADMIN_A_ID);
    expect((seated as any).success).toBe(true);
    const { data: seatedEntry } = await supabase.from('queue_entries').select('status, seated_at').eq('id', join.entry.id).single();
    expect(seatedEntry!.status).toBe('SEATED');
    expect(seatedEntry!.seated_at).toBeDefined();

    // SEATED -> WAITING (Invalid: Terminal State)
    await expect(
      QueueService.updateQueueStatus({
        entryId: join.entry.id,
        newStatus: 'WAITING',
        actorUserId: ADMIN_A_ID,
      })
    ).rejects.toThrow('INVALID_QUEUE_TRANSITION');

    // SEATED -> CANCELLED (Invalid: Terminal State)
    await expect(
      QueueService.updateQueueStatus({
        entryId: join.entry.id,
        newStatus: 'CANCELLED',
        actorUserId: ADMIN_A_ID,
      })
    ).rejects.toThrow('INVALID_QUEUE_TRANSITION');
  });

  // ---------------------------------------------------------------------------
  // 5. TOKEN SECURITY & READ MODEL ISOLATION
  // ---------------------------------------------------------------------------
  it('[TOKEN SECURITY TEST] Status lookup by token isolates data and does not leak raw token or hash', async () => {
    const join = await QueueService.joinQueue({
      restaurantId: RESTAURANT_A_ID,
      customerName: 'Secure Token Customer',
      partySize: 2,
    });

    const status = await QueueService.getQueueStatusByToken(join.rawToken);
    expect(status).toBeDefined();
    expect(status?.customerName).toBe('Secure Token Customer');
    expect(status?.partySize).toBe(2);
    expect(status?.restaurantName).toBeDefined();

    // Ensure internal security attributes are NOT present in public read model
    expect((status as any).token_hash).toBeUndefined();
    expect((status as any).rawToken).toBeUndefined();
    expect((status as any).actor_user_id).toBeUndefined();

    // Invalid raw token returns null
    const invalidStatus = await QueueService.getQueueStatusByToken('qtoken_invalid12345');
    expect(invalidStatus).toBeNull();
  });
});

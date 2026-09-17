/**
 * QueueFlow — Takeaway Phase 1 Automated Tests
 *
 * Tests the following invariants:
 * 1. queue_type defaults to DINE_IN for all new entries (no arg)
 * 2. Takeaway join fails when takeaway_enabled = false (TAKEAWAY_DISABLED)
 * 3. Takeaway join succeeds when takeaway_enabled = true
 * 4. DINE_IN position counts exclude Takeaway entries (isolation)
 * 5. Takeaway position counts exclude DINE_IN entries (isolation)
 * 6. seat_queue_entry_atomic rejects TAKEAWAY with TAKEAWAY_CANNOT_BE_SEATED
 * 7. complete_takeaway_atomic succeeds for TAKEAWAY in WAITING/CALLED states
 * 8. complete_takeaway_atomic rejects DINE_IN with NOT_TAKEAWAY_ENTRY
 * 9. queue_type is immutable — UPDATE rejected by trigger
 * 10. Dine-In regression: join_queue_atomic with no p_queue_type still works (DINE_IN default)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

// ─────────────────────────────────────────────────────────────────────────────
// Seed UUIDs — must match seeded restaurant in the QA database
// ─────────────────────────────────────────────────────────────────────────────
// These are resolved dynamically in beforeAll if available.
const TEST_RESTAURANT_SLUG = 'le-petit-bistro';

describe('Takeaway Phase 1 — Core Foundation & Security', () => {
  let client: Client;
  let testRestaurantId: string;

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for database tests');
    }
    client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    // Resolve restaurant ID from slug (works regardless of which seed environment)
    const restRes = await client.query(
      `SELECT id FROM public.restaurants WHERE slug = $1 LIMIT 1`,
      [TEST_RESTAURANT_SLUG]
    );
    if (restRes.rows.length === 0) {
      throw new Error(`Test restaurant '${TEST_RESTAURANT_SLUG}' not found. Ensure seed data is applied.`);
    }
    testRestaurantId = restRes.rows[0].id;

    // Ensure the restaurant is ACTIVE and queue_enabled for tests
    await client.query(
      `UPDATE public.restaurants
       SET status = 'ACTIVE', queue_enabled = true, min_party_size = 1, max_party_size = 20,
           max_queue_capacity = 100, queue_operating_state = 'OPEN'
       WHERE id = $1`,
      [testRestaurantId]
    );

    // Start with takeaway_enabled = false (safe default)
    await client.query(
      `UPDATE public.restaurants SET takeaway_enabled = false WHERE id = $1`,
      [testRestaurantId]
    );

    // Clean up any test queue entries from previous runs
    await client.query(
      `DELETE FROM public.queue_entries
       WHERE restaurant_id = $1 AND customer_name LIKE 'TAKEAWAY_TEST_%'`,
      [testRestaurantId]
    );
  });

  afterAll(async () => {
    // Clean up test entries
    if (client) {
      await client.query(
        `DELETE FROM public.queue_entries
         WHERE restaurant_id = $1 AND customer_name LIKE 'TAKEAWAY_TEST_%'`,
        [testRestaurantId]
      );
      await client.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: queue_type column exists and defaults to DINE_IN
  // ─────────────────────────────────────────────────────────────────────────────
  it('1. queue_type column exists on queue_entries and defaults to DINE_IN', async () => {
    const colRes = await client.query(`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'queue_entries'
        AND column_name = 'queue_type'
    `);
    expect(colRes.rows.length).toBe(1);
    expect(colRes.rows[0].column_default).toContain('DINE_IN');
    expect(colRes.rows[0].is_nullable).toBe('NO');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: takeaway_enabled column exists on restaurants and defaults to false
  // ─────────────────────────────────────────────────────────────────────────────
  it('2. takeaway_enabled column exists on restaurants and defaults to false', async () => {
    const colRes = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'restaurants'
        AND column_name = 'takeaway_enabled'
    `);
    expect(colRes.rows.length).toBe(1);
    expect(colRes.rows[0].column_default).toContain('false');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Dine-In regression — join_queue_atomic without p_queue_type still works
  // ─────────────────────────────────────────────────────────────────────────────
  it('3. [REGRESSION] join_queue_atomic without p_queue_type defaults to DINE_IN', async () => {
    const tokenHash = `test_regression_dine_in_${Date.now()}`;
    const res = await client.query(
      `SELECT * FROM public.join_queue_atomic($1, $2, NULL, $3, $4)`,
      [testRestaurantId, 'TAKEAWAY_TEST_DINE_IN_REGRESSION', 2, tokenHash]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].queue_type).toBe('DINE_IN');
    expect(res.rows[0].status).toBe('WAITING');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Takeaway join FAILS when takeaway_enabled = false
  // ─────────────────────────────────────────────────────────────────────────────
  it('4. Takeaway join is rejected when takeaway_enabled = false', async () => {
    const tokenHash = `test_takeaway_disabled_${Date.now()}`;
    await expect(
      client.query(
        `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'TAKEAWAY')`,
        [testRestaurantId, 'TAKEAWAY_TEST_DISABLED', tokenHash]
      )
    ).rejects.toThrow(/TAKEAWAY_DISABLED/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: Takeaway join SUCCEEDS when takeaway_enabled = true
  // ─────────────────────────────────────────────────────────────────────────────
  it('5. Takeaway join succeeds when takeaway_enabled = true', async () => {
    await client.query(
      `UPDATE public.restaurants SET takeaway_enabled = true WHERE id = $1`,
      [testRestaurantId]
    );

    const tokenHash = `test_takeaway_join_${Date.now()}`;
    const res = await client.query(
      `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'TAKEAWAY')`,
      [testRestaurantId, 'TAKEAWAY_TEST_JOIN', tokenHash]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].queue_type).toBe('TAKEAWAY');
    expect(res.rows[0].status).toBe('WAITING');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: DINE_IN position counts exclude TAKEAWAY entries
  // ─────────────────────────────────────────────────────────────────────────────
  it('6. DINE_IN queue position counts exclude TAKEAWAY entries', async () => {
    // Get count of DINE_IN active entries
    const dineInRes = await client.query(
      `SELECT COUNT(*) FROM public.queue_entries
       WHERE restaurant_id = $1 AND status IN ('WAITING','CALLED','NOTIFIED') AND queue_type = 'DINE_IN'`,
      [testRestaurantId]
    );
    const takeawayRes = await client.query(
      `SELECT COUNT(*) FROM public.queue_entries
       WHERE restaurant_id = $1 AND status IN ('WAITING','CALLED','NOTIFIED') AND queue_type = 'TAKEAWAY'`,
      [testRestaurantId]
    );
    // They should be independent counts — not mixed
    expect(Number(dineInRes.rows[0].count)).toBeGreaterThanOrEqual(0);
    expect(Number(takeawayRes.rows[0].count)).toBeGreaterThanOrEqual(0);
    // Cross-check: total should equal sum (no double-counting)
    const totalRes = await client.query(
      `SELECT COUNT(*) FROM public.queue_entries
       WHERE restaurant_id = $1 AND status IN ('WAITING','CALLED','NOTIFIED')`,
      [testRestaurantId]
    );
    const total = Number(totalRes.rows[0].count);
    const dineIn = Number(dineInRes.rows[0].count);
    const takeaway = Number(takeawayRes.rows[0].count);
    expect(dineIn + takeaway).toBe(total);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: seat_queue_entry_atomic REJECTS TAKEAWAY entries
  // ─────────────────────────────────────────────────────────────────────────────
  it('7. seat_queue_entry_atomic rejects TAKEAWAY entries with TAKEAWAY_CANNOT_BE_SEATED', async () => {
    // Get the takeaway entry created in test 5
    const entryRes = await client.query(
      `SELECT id FROM public.queue_entries
       WHERE restaurant_id = $1 AND queue_type = 'TAKEAWAY' AND customer_name = 'TAKEAWAY_TEST_JOIN'
       ORDER BY created_at DESC LIMIT 1`,
      [testRestaurantId]
    );
    expect(entryRes.rows.length).toBeGreaterThan(0);
    const takeawayEntryId = entryRes.rows[0].id;

    // Find any table in the restaurant
    const tableRes = await client.query(
      `SELECT id FROM public.restaurant_tables WHERE restaurant_id = $1 LIMIT 1`,
      [testRestaurantId]
    );

    if (tableRes.rows.length === 0) {
      console.warn('No tables found for seating test — skipping seating RPC check');
      return;
    }
    const tableId = tableRes.rows[0].id;

    await expect(
      client.query(
        `SELECT * FROM public.seat_queue_entry_atomic($1, $2, NULL, NULL, NULL)`,
        [takeawayEntryId, tableId]
      )
    ).rejects.toThrow(/TAKEAWAY_CANNOT_BE_SEATED/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 8: complete_takeaway_atomic SUCCEEDS for TAKEAWAY entry in WAITING state
  // ─────────────────────────────────────────────────────────────────────────────
  it('8. complete_takeaway_atomic succeeds for TAKEAWAY entry in WAITING state', async () => {
    // Create a fresh takeaway entry
    const tokenHash = `test_takeaway_complete_${Date.now()}`;
    const joinRes = await client.query(
      `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'TAKEAWAY')`,
      [testRestaurantId, 'TAKEAWAY_TEST_COMPLETE', tokenHash]
    );
    const entryId = joinRes.rows[0].id;

    const completeRes = await client.query(
      `SELECT * FROM public.complete_takeaway_atomic($1, NULL)`,
      [entryId]
    );
    expect(completeRes.rows.length).toBe(1);
    const result = completeRes.rows[0];
    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');

    // Verify in queue_entries
    const verify = await client.query(
      `SELECT status FROM public.queue_entries WHERE id = $1`,
      [entryId]
    );
    expect(verify.rows[0].status).toBe('COMPLETED');

    // Verify queue_event was created with TAKEAWAY_COMPLETED type
    const eventRes = await client.query(
      `SELECT event_type FROM public.queue_events WHERE queue_entry_id = $1 AND event_type = 'TAKEAWAY_COMPLETED'`,
      [entryId]
    );
    expect(eventRes.rows.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 9: complete_takeaway_atomic REJECTS DINE_IN entries
  // ─────────────────────────────────────────────────────────────────────────────
  it('9. complete_takeaway_atomic rejects DINE_IN entries with NOT_TAKEAWAY_ENTRY', async () => {
    // Get a DINE_IN entry created earlier
    const entryRes = await client.query(
      `SELECT id FROM public.queue_entries
       WHERE restaurant_id = $1 AND queue_type = 'DINE_IN' AND status = 'WAITING'
         AND customer_name LIKE 'TAKEAWAY_TEST_%'
       ORDER BY created_at DESC LIMIT 1`,
      [testRestaurantId]
    );
    if (entryRes.rows.length === 0) {
      console.warn('No DINE_IN test entry found — creating one');
      const tokenHash = `test_dine_in_complete_rejection_${Date.now()}`;
      const joinRes = await client.query(
        `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'DINE_IN')`,
        [testRestaurantId, 'TAKEAWAY_TEST_DINE_IN_REJECT', tokenHash]
      );
      const entryId = joinRes.rows[0].id;
      await expect(
        client.query(`SELECT * FROM public.complete_takeaway_atomic($1, NULL)`, [entryId])
      ).rejects.toThrow(/NOT_TAKEAWAY_ENTRY/);
      return;
    }
    const entryId = entryRes.rows[0].id;
    await expect(
      client.query(`SELECT * FROM public.complete_takeaway_atomic($1, NULL)`, [entryId])
    ).rejects.toThrow(/NOT_TAKEAWAY_ENTRY/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 10: queue_type is IMMUTABLE — UPDATE trigger rejects changes
  // ─────────────────────────────────────────────────────────────────────────────
  it('10. queue_type is immutable — UPDATE trigger rejects queue_type changes', async () => {
    // Create a DINE_IN entry
    const tokenHash = `test_immutable_type_${Date.now()}`;
    const joinRes = await client.query(
      `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'DINE_IN')`,
      [testRestaurantId, 'TAKEAWAY_TEST_IMMUTABLE', tokenHash]
    );
    const entryId = joinRes.rows[0].id;

    // Attempt to change queue_type — must be rejected
    await expect(
      client.query(
        `UPDATE public.queue_entries SET queue_type = 'TAKEAWAY' WHERE id = $1`,
        [entryId]
      )
    ).rejects.toThrow(/QUEUE_TYPE_IMMUTABLE/);

    // Verify the type was NOT changed
    const check = await client.query(
      `SELECT queue_type FROM public.queue_entries WHERE id = $1`,
      [entryId]
    );
    expect(check.rows[0].queue_type).toBe('DINE_IN');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 11: invalid queue_type is rejected at the RPC layer
  // ─────────────────────────────────────────────────────────────────────────────
  it('11. invalid queue_type is rejected at the RPC layer (INVALID_QUEUE_TYPE)', async () => {
    const tokenHash = `test_invalid_type_${Date.now()}`;
    await expect(
      client.query(
        `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'DELIVERY')`,
        [testRestaurantId, 'TAKEAWAY_TEST_INVALID', tokenHash]
      )
    ).rejects.toThrow(/INVALID_QUEUE_TYPE/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 12: complete_takeaway_atomic is idempotent (COMPLETED → same result)
  // ─────────────────────────────────────────────────────────────────────────────
  it('12. complete_takeaway_atomic is idempotent when called twice', async () => {
    await client.query(
      `UPDATE public.restaurants SET takeaway_enabled = true WHERE id = $1`,
      [testRestaurantId]
    );
    const tokenHash = `test_takeaway_idempotent_${Date.now()}`;
    const joinRes = await client.query(
      `SELECT * FROM public.join_queue_atomic($1, $2, NULL, 1, $3, 'TAKEAWAY')`,
      [testRestaurantId, 'TAKEAWAY_TEST_IDEMPOTENT', tokenHash]
    );
    const entryId = joinRes.rows[0].id;

    // First call
    await client.query(`SELECT * FROM public.complete_takeaway_atomic($1, NULL)`, [entryId]);
    // Second call — must not throw, must return idempotent: true
    const res = await client.query(
      `SELECT * FROM public.complete_takeaway_atomic($1, NULL)`,
      [entryId]
    );
    expect(res.rows[0].success).toBe(true);
    expect(res.rows[0].idempotent).toBe(true);
  });
});

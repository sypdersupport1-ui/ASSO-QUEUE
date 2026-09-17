import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { QueueService } from '@/lib/services/queue-service';
import { OutboxService } from '@/lib/services/outbox-service';
import type { OutboxEventRecord } from '@/lib/services/notification-service';
import { createAdminClient } from '@/lib/db/supabase/admin';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

describe('Phase 3A: Outbox Concurrency + Queue Maintenance', () => {
  let client: Client;
  const supabase = createAdminClient();

  const RESTAURANT_ID = '33333333-3333-4333-a333-333333333333';

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live worker tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status, call_timeout_minutes, auto_expire_called)
       VALUES ($1, 'Phase 3A Worker Demo', 'phase3a-worker-demo', true, 100, 1, 20, 'ACTIVE', 15, true)
       ON CONFLICT (id) DO UPDATE SET queue_enabled = true, status = 'ACTIVE', call_timeout_minutes = 15, auto_expire_called = true`,
      [RESTAURANT_ID]
    );
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id = $1`, [RESTAURANT_ID]);
    await client.query(`DELETE FROM public.outbox_events WHERE restaurant_id = $1`, [RESTAURANT_ID]);
    await client.query(`DELETE FROM public.notifications WHERE restaurant_id = $1`, [RESTAURANT_ID]);
  });

  afterAll(async () => {
    // NOTE: the 33333333 fixture is intentionally NOT deleted here — it is
    // shared with cron-live-verify.test.ts, which runs in parallel. Deleting
    // it here would race the other file's tests (use-after-delete).
    // Timestamped fixtures (payments/outbox) are per-file and self-clean.
    if (client) await client.end();
  });

  it('A. Two workers cannot claim the same pending event', async () => {
    const id = await OutboxService.publishEvent({
      restaurantId: RESTAURANT_ID,
      eventType: 'QUEUE_JOINED',
      aggregateType: 'QUEUE',
      aggregateId: 'claim-race-1',
      payload: { test: true },
    });
    expect(id).toBeDefined();

    const [a, b] = await Promise.all([
      OutboxService.getPendingEvents(10),
      OutboxService.getPendingEvents(10),
    ]);
    const idsA = new Set(a.map((e: { id: string }) => e.id));
    const overlap = b.filter((e: { id: string }) => idsA.has(e.id));
    expect(overlap.length).toBe(0);

    // Cleanup: complete whatever was claimed
    for (const e of [...a, ...b]) {
      await OutboxService.markCompleted(e.id);
    }
  });

  it('B. Claimed event becomes processable again after lease expiry', async () => {
    const id = await OutboxService.publishEvent({
      restaurantId: RESTAURANT_ID,
      eventType: 'QUEUE_JOINED',
      aggregateType: 'QUEUE',
      aggregateId: 'lease-test-1',
      payload: { test: true },
    });
    // Simulate a crashed worker holding the claim: move ONLY our row to stale
    // PROCESSING directly (no global claim, so parallel test files are unaffected).
    await client.query(
      `UPDATE public.outbox_events SET status = 'PROCESSING', updated_at = NOW() - INTERVAL '31 minutes' WHERE id = $1`,
      [id]
    );
    const recovered = await OutboxService.recoverStaleEvents(30);
    expect(recovered).toBeGreaterThanOrEqual(1);
    const { data } = await supabase.from('outbox_events').select('status').eq('id', id).single();
    expect(data?.status).toBe('PENDING');
    await OutboxService.markCompleted(id);
  });

  it('C+D+E+F. Failed processing increments retry with backoff; max attempts terminal', async () => {
    const id = await OutboxService.publishEvent({
      restaurantId: RESTAURANT_ID,
      eventType: 'MOCK_FAIL',
      aggregateType: 'SYSTEM',
      aggregateId: 'retry-test-1',
      payload: {},
    });
    await OutboxService.markFailed(id, 'boom', 0, 5);
    const { data: r1 } = await supabase.from('outbox_events').select('status, retry_count, next_attempt_at').eq('id', id).single();
    expect(r1?.status).toBe('PENDING');
    expect(r1?.retry_count).toBe(1);
    expect(new Date(r1!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    await OutboxService.markFailed(id, 'boom', 4, 5);
    const { data: r2 } = await supabase.from('outbox_events').select('status, retry_count').eq('id', id).single();
    expect(r2?.status).toBe('FAILED');
    expect(r2?.retry_count).toBe(5);
  });

  it('G. Duplicate invocation does not duplicate internal notifications', async () => {
    const { NotificationService } = await import('@/lib/services/notification-service');
    const join = await QueueService.joinQueue({ restaurantId: RESTAURANT_ID, customerName: 'Idem Idem', partySize: 2 });
    const id = await OutboxService.publishEvent({
      restaurantId: RESTAURANT_ID,
      eventType: 'QUEUE_JOINED',
      aggregateType: 'QUEUE',
      aggregateId: join.entry.id,
      payload: { customerName: 'Idem', displayNumber: '1', partySize: 2 },
    });
    // Simulate crash-between-send-and-complete: process the same event twice
    const event = {
      id, restaurant_id: RESTAURANT_ID, event_type: 'QUEUE_JOINED',
      aggregate_type: 'QUEUE', aggregate_id: join.entry.id,
      payload: { customerName: 'Idem', displayNumber: '1', partySize: 2 },
      status: 'PROCESSING', retry_count: 0, max_retries: 5, created_at: new Date().toISOString(),
    };
    await NotificationService.processOutboxEvent(event as OutboxEventRecord);
    await NotificationService.processOutboxEvent(event as OutboxEventRecord);
    const { data, count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact' })
      .eq('idempotency_key', id);
    expect(count).toBe(1);
    expect(data?.length).toBe(1);
    await OutboxService.markCompleted(id);
  });

  it('Queue maintenance: overdue CALLED -> NO_SHOW with reason, timestamp, events exactly once', async () => {
    const join = await QueueService.joinQueue({ restaurantId: RESTAURANT_ID, customerName: 'Overdue Ollie', partySize: 2 });
    const { createAdminClient: admin } = await import('@/lib/db/supabase/admin');
    const sb = admin();
    // Move to CALLED via RPC with actor, then backdate called_at beyond timeout
    await sb.rpc('transition_queue_entry_atomic', {
      p_queue_entry_id: join.entry.id,
      p_target_status: 'CALLED',
      p_actor_user_id: null,
      p_reason: null,
    });
    await client.query(`UPDATE public.queue_entries SET called_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [join.entry.id]);

    const before = await supabase.from('outbox_events').select('id', { count: 'exact' }).eq('aggregate_id', join.entry.id).eq('event_type', 'QUEUE_NO_SHOW');
    expect(before.count || 0).toBe(0);

    const res = await QueueService.expireOverdueCalledEntries(50);
    // The live pg_cron job (every minute) may have fired in the millisecond gap
    // after the UPDATE. If our call expired it, verify count and id; otherwise verify
    // the end state was produced by the expiration RPC.
    if (res.expiredCount >= 1) {
      expect(res.expiredIds).toContain(join.entry.id);
    }

    const { data: entry } = await supabase.from('queue_entries').select('status, no_show_reason, no_show_at').eq('id', join.entry.id).single();
    expect(entry?.status).toBe('NO_SHOW');
    expect(entry?.no_show_reason).toBe('CUSTOMER_DID_NOT_RESPOND');
    expect(entry?.no_show_at).toBeDefined();

    const { count: evCount } = await supabase.from('queue_events').select('id', { count: 'exact' }).eq('queue_entry_id', join.entry.id).eq('event_type', 'QUEUE_NO_SHOW');
    expect(evCount).toBe(1);
    const { count: obCount } = await supabase.from('outbox_events').select('id', { count: 'exact' }).eq('aggregate_id', join.entry.id).eq('event_type', 'QUEUE_NO_SHOW');
    expect(obCount).toBe(1);
  });

  it('Queue maintenance leaves non-overdue/WAITING/NOTIFIED/terminal unchanged; second run idempotent', async () => {
    const w = await QueueService.joinQueue({ restaurantId: RESTAURANT_ID, customerName: 'Waiting Wendy', partySize: 2 });
    const sb = createAdminClient();
    const n = await QueueService.joinQueue({ restaurantId: RESTAURANT_ID, customerName: 'Notified Ned', partySize: 2 });
    await sb.rpc('transition_queue_entry_atomic', { p_queue_entry_id: n.entry.id, p_target_status: 'NOTIFIED', p_actor_user_id: null, p_reason: null });
    const c = await QueueService.joinQueue({ restaurantId: RESTAURANT_ID, customerName: 'Called Cathy', partySize: 2 });
    await sb.rpc('transition_queue_entry_atomic', { p_queue_entry_id: c.entry.id, p_target_status: 'CALLED', p_actor_user_id: null, p_reason: null });
    // c.called_at is now() -> not overdue (timeout 15m)

    const r1 = await QueueService.expireOverdueCalledEntries(50);
    const { data: wAfter } = await supabase.from('queue_entries').select('status').eq('id', w.entry.id).single();
    const { data: nAfter } = await supabase.from('queue_entries').select('status').eq('id', n.entry.id).single();
    const { data: cAfter } = await supabase.from('queue_entries').select('status').eq('id', c.entry.id).single();
    expect(wAfter?.status).toBe('WAITING');
    expect(nAfter?.status).toBe('NOTIFIED');
    expect(cAfter?.status).toBe('CALLED');

    // Second run: idempotent, expires nothing new related to these
    const r2 = await QueueService.expireOverdueCalledEntries(50);
    expect(r2.expiredIds).not.toContain(w.entry.id);
    expect(r2.expiredIds).not.toContain(n.entry.id);
    expect(r2.expiredIds).not.toContain(c.entry.id);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
  });

  it('Concurrent maintenance workers do not double-transition', async () => {
    const sb = createAdminClient();
    // Bounded retries: the live pg_cron job (every minute on this database)
    // may expire our backdated row between the UPDATE and the two worker
    // calls. In that case neither worker wins, but the exactly-once
    // invariant still holds and is verified via the outbox count below.
    let entryId = '';
    let decided = false;
    for (let attempt = 0; attempt < 3 && !decided; attempt++) {
      const join = await QueueService.joinQueue({ restaurantId: RESTAURANT_ID, customerName: 'Race Ray', partySize: 2 });
      entryId = join.entry.id;
      await sb.rpc('transition_queue_entry_atomic', { p_queue_entry_id: join.entry.id, p_target_status: 'CALLED', p_actor_user_id: null, p_reason: null });
      await client.query(`UPDATE public.queue_entries SET called_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [join.entry.id]);

      const [a, b] = await Promise.all([
        QueueService.expireOverdueCalledEntries(50),
        QueueService.expireOverdueCalledEntries(50),
      ]);
      const total = (a.expiredIds.includes(join.entry.id) ? 1 : 0) + (b.expiredIds.includes(join.entry.id) ? 1 : 0);
      // A real double-transition must fail fast (retrying would mask it).
      expect(total).toBeLessThanOrEqual(1);
      if (total === 1) {
        decided = true;
      } else {
        const { data } = await supabase.from('queue_entries').select('status').eq('id', join.entry.id).single();
        if (data?.status === 'NO_SHOW') decided = true; // pg_cron won; invariant checked below
      }
    }
    expect(decided).toBe(true);

    const { count } = await supabase.from('outbox_events').select('id', { count: 'exact' }).eq('aggregate_id', entryId).eq('event_type', 'QUEUE_NO_SHOW');
    expect(count).toBe(1);
  });
});

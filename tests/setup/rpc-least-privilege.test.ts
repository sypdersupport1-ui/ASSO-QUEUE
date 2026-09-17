import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { RestaurantAdminService } from '@/lib/services/restaurant-admin-service';
import { getEnv, resetEnvCacheForTesting } from '@/lib/config/env';

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;
const LAB_RID = 'f0f0f0f0-1111-4111-a111-111111111111';

/**
 * Phase 3E: least-privilege verification for SECURITY DEFINER RPCs and
 * hardened RLS/constraints. Structural grant assertions (deterministic)
 * plus behavioral tests through real low-privilege JWTs.
 */
describe('Phase 3E: RPC grants + RLS hardening (live)', () => {
  let client: Client;
  let admin: SupabaseClient;
  let anonUrl = '';
  let anonKey = '';
  let attackerJwt: SupabaseClient | null = null;
  let attackerUserId = '';
  let staffJwt: SupabaseClient | null = null;
  let staffUserId = '';
  let entryId = '';
  let tableId = '';

  async function aclOf(fn: string): Promise<string[]> {
    const { rows } = await client.query(
      `SELECT unnest(COALESCE(proacl, ARRAY[]::aclitem[]))::text AS ace
       FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1`,
      [fn]
    );
    return rows.map((r) => r.ace as string);
  }

  function grantees(aces: string[]): string[] {
    // aclitem text form: "grantee=privs/grantor" (empty grantee = PUBLIC)
    return aces.map((a) => a.split('=')[0] ?? '');
  }

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live grant tests');
    }
    client = new Client({ connectionString });
    await client.connect();
    admin = createAdminClient();
    const env = getEnv();
    anonUrl = env.public.NEXT_PUBLIC_SUPABASE_URL;
    anonKey = env.public.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, status)
       VALUES ($1, 'Grant Lab', 'grant-lab-9e', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [LAB_RID]
    );
    const t = await client.query(
      `INSERT INTO public.restaurant_tables (restaurant_id, table_number, capacity, status)
       VALUES ($1, 'G1', 4, 'AVAILABLE') RETURNING id`,
      [LAB_RID]
    );
    tableId = t.rows[0].id;
    const q = await client.query(
      `INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, queue_number, status)
       VALUES ($1, 'Grant Victim', 2, 1, 'WAITING') RETURNING id`,
      [LAB_RID]
    );
    entryId = q.rows[0].id;

    // Throwaway login-capable user with NO membership (outsider).
    const emailA = `grant-attacker-${Date.now()}@example.com`;
    const { data: createdA } = await admin.auth.admin.createUser({
      email: emailA,
      password: 'Test1234!',
      email_confirm: true,
    });
    attackerUserId = createdA.user!.id;
    attackerJwt = createClient(anonUrl, anonKey, { auth: { persistSession: false } });
    await attackerJwt.auth.signInWithPassword({ email: emailA, password: 'Test1234!' });

    // Throwaway STAFF member of the lab restaurant (insider, low privilege).
    const emailS = `grant-staff-${Date.now()}@example.com`;
    const { data: createdS } = await admin.auth.admin.createUser({
      email: emailS,
      password: 'Test1234!',
      email_confirm: true,
    });
    staffUserId = createdS.user!.id;
    await client.query(
      `INSERT INTO public.user_profiles (id, display_name, email)
       VALUES ($1, 'Grant Staff', $2) ON CONFLICT (id) DO NOTHING`,
      [staffUserId, emailS]
    );
    await client.query(
      `INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
       VALUES ($1, $2, 'STAFF', 'ACTIVE')
       ON CONFLICT (user_id, restaurant_id, role) DO UPDATE SET status = 'ACTIVE'`,
      [staffUserId, LAB_RID]
    );
    staffJwt = createClient(anonUrl, anonKey, { auth: { persistSession: false } });
    await staffJwt.auth.signInWithPassword({ email: emailS, password: 'Test1234!' });
  });

  afterAll(async () => {
    try {
      await client.query('DELETE FROM public.queue_entries WHERE restaurant_id = $1', [LAB_RID]);
      await client.query('DELETE FROM public.restaurant_tables WHERE restaurant_id = $1', [LAB_RID]);
      await client.query('DELETE FROM public.restaurant_memberships WHERE restaurant_id = $1', [LAB_RID]);
      await client.query('DELETE FROM public.user_profiles WHERE id = ANY($1)', [
        [attackerUserId, staffUserId].filter(Boolean),
      ]);
      await client.query('DELETE FROM public.restaurants WHERE id = $1', [LAB_RID]);
      if (attackerUserId) await admin.auth.admin.deleteUser(attackerUserId);
      if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);
    } finally {
      if (client) await client.end();
    }
  });

  it('privileged queue RPCs grant EXECUTE to service_role only', async () => {
    for (const fn of [
      'seat_queue_entry_atomic',
      'transition_queue_entry_atomic',
      'set_queue_operating_state',
      'expire_overdue_called_queue_entries',
    ]) {
      const g = grantees(await aclOf(fn));
      expect(g, fn).toContain('service_role');
      expect(g, fn).not.toContain('anon');
      expect(g, fn).not.toContain('authenticated');
      expect(g, fn).not.toContain('');
    }
  });

  it('worker/inventory RPCs grant EXECUTE to service_role only', async () => {
    for (const fn of [
      'claim_outbox_events',
      'recover_stale_outbox_events',
      'deduct_inventory_atomic',
    ]) {
      const g = grantees(await aclOf(fn));
      expect(g, fn).toContain('service_role');
      expect(g, fn).not.toContain('anon');
      expect(g, fn).not.toContain('authenticated');
      expect(g, fn).not.toContain('');
    }
  });

  it('public join stays callable; helper oracles stay authenticated-only', async () => {
    const join = grantees(await aclOf('join_queue_atomic'));
    expect(join).toContain('anon');

    for (const fn of ['is_super_admin', 'has_permission']) {
      const g = grantees(await aclOf(fn));
      expect(g, fn).not.toContain('anon');
      expect(g, fn).toContain('authenticated');
    }
  });

  it('outsider JWT cannot seat, transition, close, or expire (permission denied)', async () => {
    const jwt = attackerJwt!;
    const seat = await jwt.rpc('seat_queue_entry_atomic', {
      p_queue_entry_id: entryId,
      p_table_id: tableId,
      p_actor_user_id: null,
    });
    expect(seat.error?.message).toMatch(/permission denied/i);

    const transition = await jwt.rpc('transition_queue_entry_atomic', {
      p_queue_entry_id: entryId,
      p_target_status: 'CALLED',
      p_actor_user_id: null,
      p_reason: null,
    });
    expect(transition.error?.message).toMatch(/permission denied/i);

    const state = await jwt.rpc('set_queue_operating_state', {
      p_restaurant_id: LAB_RID,
      p_new_state: 'CLOSED',
      p_actor_user_id: null,
      p_reason: null,
    });
    expect(state.error?.message).toMatch(/permission denied/i);

    const expire = await jwt.rpc('expire_overdue_called_queue_entries', { p_limit: 5 });
    expect(expire.error?.message).toMatch(/permission denied/i);

    // Victim rows untouched.
    const { rows } = await client.query(
      `SELECT status FROM public.queue_entries WHERE id = $1`,
      [entryId]
    );
    expect(rows[0].status).toBe('WAITING');
    const rest = await client.query(`SELECT queue_operating_state FROM public.restaurants WHERE id = $1`, [
      LAB_RID,
    ]);
    expect(rest.rows[0].queue_operating_state).toBe('OPEN');
  });

  it('DB trigger rejects impossible FSM jumps even for same-tenant members', async () => {
    const jwt = staffJwt!;
    // WAITING -> legacy COMPLETED: never a valid edge.
    const bad1 = await jwt.from('queue_entries').update({ status: 'COMPLETED' }).eq('id', entryId);
    expect(bad1.error?.message).toMatch(/INVALID_QUEUE_TRANSITION/i);

    // Move to CANCELLED through the valid edge, then try resurrection.
    const ok = await jwt.from('queue_entries').update({ status: 'CANCELLED' }).eq('id', entryId);
    expect(ok.error).toBeNull();
    const bad2 = await jwt.from('queue_entries').update({ status: 'WAITING' }).eq('id', entryId);
    expect(bad2.error?.message).toMatch(/INVALID_QUEUE_TRANSITION/i);

    const { rows } = await client.query(`SELECT status FROM public.queue_entries WHERE id = $1`, [
      entryId,
    ]);
    expect(rows[0].status).toBe('CANCELLED');
  });

  it('authenticated users cannot squat other user profiles', async () => {
    const jwt = attackerJwt!;
    const squat = await jwt.from('user_profiles').insert({
      id: staffUserId,
      display_name: 'Squatter',
    });
    expect(squat.error).not.toBeNull();

    // Own profile insert remains allowed (positive control).
    const own = await jwt.from('user_profiles').insert({
      id: attackerUserId,
      display_name: 'Attacker Own',
    });
    expect(own.error).toBeNull();
    await client.query('DELETE FROM public.user_profiles WHERE id = $1', [attackerUserId]);
  });

  it('queue token uniqueness is scoped per restaurant (no cross-tenant squat)', async () => {
    const tokenHash = 'f'.repeat(64);
    await client.query(
      `INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, queue_number, status, token_hash)
       VALUES ($1, 'Scope A', 1, 101, 'WAITING', $2)`,
      [LAB_RID, tokenHash]
    );
    const otherRestaurant = 'f1f1f1f1-1111-4111-a111-111111111111';
    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, status)
       VALUES ($1, 'Scope Other', 'scope-other-9e', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
      [otherRestaurant]
    );
    // Same hash in another restaurant: allowed (scoped, not global).
    await client.query(
      `INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, queue_number, status, token_hash)
       VALUES ($1, 'Scope B', 1, 101, 'WAITING', $2)`,
      [otherRestaurant, tokenHash]
    );
    // Same hash twice in the SAME restaurant: rejected.
    await expect(
      client.query(
        `INSERT INTO public.queue_entries (restaurant_id, customer_name, party_size, queue_number, status, token_hash)
         VALUES ($1, 'Scope Dup', 1, 102, 'WAITING', $2)`,
        [LAB_RID, tokenHash]
      )
    ).rejects.toThrow(/duplicate key|unique/i);

    await client.query('DELETE FROM public.queue_entries WHERE token_hash = $1', [tokenHash]);
    await client.query('DELETE FROM public.restaurants WHERE id = $1', [otherRestaurant]);
  });

  it('suspended/archived restaurants are refused by assertRestaurantActive', async () => {
    await RestaurantAdminService.assertRestaurantActive(LAB_RID);
    await client.query(`UPDATE public.restaurants SET status = 'SUSPENDED' WHERE id = $1`, [LAB_RID]);
    await expect(RestaurantAdminService.assertRestaurantActive(LAB_RID)).rejects.toThrow(
      /not currently active/i
    );
    await client.query(`UPDATE public.restaurants SET status = 'ARCHIVED' WHERE id = $1`, [LAB_RID]);
    await expect(RestaurantAdminService.assertRestaurantActive(LAB_RID)).rejects.toThrow(
      /not currently active/i
    );
    await expect(
      RestaurantAdminService.assertRestaurantActive('00000000-0000-4000-a000-000000000000')
    ).rejects.toThrow(/not currently active/i);
    await client.query(`UPDATE public.restaurants SET status = 'ACTIVE' WHERE id = $1`, [LAB_RID]);
  });
});

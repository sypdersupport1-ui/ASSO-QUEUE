import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { createAdminClient } from '@/lib/db/supabase/admin';
import { acceptInvitationForUser } from '@/lib/services/staff-invitation-service';
import { resetEnvCacheForTesting } from '@/lib/config/env';

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;

// Dedicated restaurants for the invitation acceptance tests.
const REST_A = 'a3c3c3c3-1111-4111-a111-111111111111';
const REST_B = 'b3c3c3c3-2222-4222-b222-222222222222';
const REST_C = 'c3c3c3c3-3333-4333-c333-333333333333';

describe('Phase 3C: Live invitation acceptance (INVITED -> ACTIVE)', () => {
  let client: Client;
  let userId = '';
  let otherUserId = '';
  let memA = '';
  let memB = '';
  let memC = '';
  let memOther = '';
  const email = `invite-accept-${Date.now()}@example.com`;
  const otherEmail = `invite-accept-other-${Date.now()}@example.com`;

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live invitation tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, status)
       VALUES ($1, 'Invite Test A', 'invite-test-a-3c', 'ACTIVE'),
              ($2, 'Invite Test B', 'invite-test-b-3c', 'ACTIVE'),
              ($3, 'Invite Test C', 'invite-test-c-3c', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [REST_A, REST_B, REST_C]
    );

    const admin = createAdminClient();

    // createUser sends NO email (unlike inviteUserByEmail) — safe for tests.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: `Pw-${Date.now()}-x9!`,
      email_confirm: true,
      user_metadata: { restaurant_id: REST_A, role: 'STAFF' },
    });
    if (createErr || !created.user) throw new Error(`setup: createUser failed: ${createErr?.message}`);
    userId = created.user.id;

    const { data: createdOther, error: createOtherErr } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: `Pw-${Date.now()}-y9!`,
      email_confirm: true,
      user_metadata: { restaurant_id: REST_A, role: 'STAFF' },
    });
    if (createOtherErr || !createdOther.user) throw new Error(`setup: createUser(2) failed: ${createOtherErr?.message}`);
    otherUserId = createdOther.user.id;

    await client.query(
      `INSERT INTO public.user_profiles (id, display_name, email)
       VALUES ($1, 'Invitee', $2), ($3, 'Other', $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userId, email, otherUserId, otherEmail]
    );

    const ins = await client.query(
      `INSERT INTO public.restaurant_memberships
         (user_id, restaurant_id, role, status, invited_at)
       VALUES
         ($1, $2, 'STAFF', 'INVITED', NOW()),
         ($1, $3, 'STAFF', 'INVITED', NOW()),
         ($1, $4, 'STAFF', 'ACTIVE', NOW()),
         ($5, $2, 'STAFF', 'INVITED', NOW())
       RETURNING id, restaurant_id, user_id`,
      [userId, REST_A, REST_B, REST_C, otherUserId]
    );
    for (const row of ins.rows as Array<{ id: string; restaurant_id: string; user_id: string }>) {
      if (row.user_id === userId && row.restaurant_id === REST_A) memA = row.id;
      if (row.user_id === userId && row.restaurant_id === REST_B) memB = row.id;
      if (row.user_id === userId && row.restaurant_id === REST_C) memC = row.id;
      if (row.user_id === otherUserId) memOther = row.id;
    }
    expect(memA && memB && memC && memOther).toBeTruthy();
  });

  afterAll(async () => {
    try {
      const admin = createAdminClient();
      await client.query(
        `DELETE FROM public.restaurant_memberships WHERE id = ANY($1)`,
        [[memA, memB, memC, memOther].filter(Boolean)]
      );
      await client.query(`DELETE FROM public.user_profiles WHERE id = ANY($1)`, [
        [userId, otherUserId].filter(Boolean),
      ]);
      await client.query(`DELETE FROM public.restaurants WHERE id = ANY($1)`, [
        [REST_A, REST_B, REST_C],
      ]);
      if (userId) await admin.auth.admin.deleteUser(userId);
      if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
    } finally {
      if (client) await client.end();
    }
  });

  it('activates ONLY the invited membership matching the Auth invitation context', async () => {
    const result = await acceptInvitationForUser(userId);

    expect(result.alreadyActive).toBe(false);
    expect(result.activatedMembershipIds).toEqual([memA]);
    expect(result.dashboardPath).toBe('/dashboard/operational');

    const { rows } = await client.query(
      `SELECT id, status, invitation_accepted_at FROM public.restaurant_memberships WHERE id = ANY($1)`,
      [[memA, memB, memC, memOther]]
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Invited membership in the invitation restaurant: ACTIVE + timestamp.
    expect(byId[memA].status).toBe('ACTIVE');
    expect(byId[memA].invitation_accepted_at).toBeTruthy();

    // Same user, other restaurant: untouched.
    expect(byId[memB].status).toBe('INVITED');
    expect(byId[memB].invitation_accepted_at).toBeNull();

    // Same user, already ACTIVE elsewhere: unchanged.
    expect(byId[memC].status).toBe('ACTIVE');

    // Other user's invitation in the same restaurant: untouched.
    expect(byId[memOther].status).toBe('INVITED');
  });

  it('records STAFF_INVITATION_ACCEPTED audit for the activated membership only', async () => {
    const { rows } = await client.query(
      `SELECT entity_id FROM public.audit_logs
       WHERE action = 'STAFF_INVITATION_ACCEPTED' AND actor_user_id = $1`,
      [userId]
    );
    expect(rows.map((r) => r.entity_id)).toEqual([memA]);
  });

  it('repeat acceptance is idempotent (alreadyActive, no duplicates)', async () => {
    const result = await acceptInvitationForUser(userId);
    expect(result.alreadyActive).toBe(true);
    expect(result.activatedMembershipIds).toEqual([]);

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.restaurant_memberships
       WHERE user_id = $1 AND restaurant_id = $2 AND role = 'STAFF'`,
      [userId, REST_A]
    );
    expect(rows[0].n).toBe(1);
  });

  it('rejects acceptance with no pending invitation and no active role', async () => {
    await expect(acceptInvitationForUser('00000000-0000-4000-a000-000000000000')).rejects.toThrow(
      /No pending invitation/
    );
    await expect(acceptInvitationForUser('')).rejects.toThrow(/Authentication required/);
  });
});

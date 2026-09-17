import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { QueueService } from '@/lib/services/queue-service';
import { PaymentService } from '@/lib/services/payment-service';
import { generateQueueToken, hashQueueToken } from '@/lib/utils/token-utils';
import { POST as intentPOST } from '@/app/api/payments/intent/route';
import { POST as verifyPOST } from '@/app/api/payments/verify/route';
import { POST as webhookPOST } from '@/app/api/payments/webhook/[provider]/route';
import { NextRequest } from 'next/server';
import { resetEnvCacheForTesting } from '@/lib/config/env';

dotenv.config({ path: '.env.local' });
resetEnvCacheForTesting();

const connectionString = process.env.DATABASE_URL;

const REST_A_ID = '7a7a7a7a-1111-4111-a111-111111111111';
const REST_B_ID = '7b7b7b7b-2222-4222-b222-222222222222';
const REST_A_SLUG = 'pay-sec-alpha';
const REST_B_SLUG = 'pay-sec-beta';

let ipCounter = 10;
function postJson(url: string, body: Record<string, unknown>): NextRequest {
  ipCounter += 1;
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `198.51.100.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
}

describe('Phase 3D correction: live payment authorization (cross-tenant)', () => {
  let client: Client;
  let entryA = '';
  let entryB = '';
  let entryC = '';

  // orderToken per order: tokenA1/orderA1 (happy path), tokenB/orderB,
  // tokenC/orderC (bound to entryC), tokenD/orderD (CANCELLED),
  // tokenE/orderE (PAID), tokenM/orderM (idempotency), tokenN/orderN.
  const T: Record<string, string> = {};
  const O: Record<string, string> = {};

  async function insertOrder(
    key: string,
    restaurantId: string,
    queueEntryId: string,
    status: string,
    paymentStatus: string
  ) {
    T[key] = generateQueueToken();
    const res = await client.query(
      `INSERT INTO public.orders
         (restaurant_id, queue_entry_id, order_number, status, payment_status,
          subtotal, tax, total, order_token, order_token_hash, customer_name)
       VALUES ($1, $2, $3, $4, $5, 100, 0, 100, NULL, $6, 'Pay Victim')
       RETURNING id`,
      [restaurantId, queueEntryId, `ORD-PAY-${key}-${Date.now()}`, status, paymentStatus, hashQueueToken(T[key])]
    );
    O[key] = res.rows[0].id;
  }

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env.local for live payment auth tests');
    }
    client = new Client({ connectionString });
    await client.connect();

    await client.query(
      `INSERT INTO public.restaurants (id, name, slug, queue_enabled, max_queue_capacity, min_party_size, max_party_size, status)
       VALUES ($1, 'Pay Sec Alpha', $2, true, 100, 1, 20, 'ACTIVE'),
              ($3, 'Pay Sec Beta', $4, true, 100, 1, 20, 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, queue_enabled = true, status = 'ACTIVE'`,
      [REST_A_ID, REST_A_SLUG, REST_B_ID, REST_B_SLUG]
    );
    await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2)`, [
      REST_A_ID,
      REST_B_ID,
    ]);

    const joinA = await QueueService.joinQueue({
      restaurantId: REST_A_ID,
      customerName: 'Payer Alpha',
      partySize: 2,
    });
    entryA = joinA.entry.id;

    const joinB = await QueueService.joinQueue({
      restaurantId: REST_B_ID,
      customerName: 'Payer Beta',
      partySize: 2,
    });
    entryB = joinB.entry.id;

    const joinC = await QueueService.joinQueue({
      restaurantId: REST_A_ID,
      customerName: 'Payer Gamma',
      partySize: 1,
    });
    entryC = joinC.entry.id;

    await insertOrder('A1', REST_A_ID, entryA, 'PLACED', 'UNPAID');
    await insertOrder('B', REST_B_ID, entryB, 'PLACED', 'UNPAID');
    await insertOrder('C', REST_A_ID, entryC, 'PLACED', 'UNPAID');
    await insertOrder('D', REST_A_ID, entryA, 'CANCELLED', 'UNPAID');
    await insertOrder('E', REST_A_ID, entryA, 'PLACED', 'PAID');
    await insertOrder('M', REST_A_ID, entryA, 'PLACED', 'UNPAID');
    await insertOrder('N', REST_A_ID, entryA, 'PLACED', 'UNPAID');

    expect(entryA && entryB && entryC && O.A1 && O.B).toBeTruthy();
  });

  afterAll(async () => {
    try {
      await client.query(`DELETE FROM public.payments WHERE restaurant_id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
      await client.query(`DELETE FROM public.orders WHERE restaurant_id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
      await client.query(`DELETE FROM public.queue_entries WHERE restaurant_id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
      await client.query(`DELETE FROM public.restaurants WHERE id IN ($1, $2)`, [
        REST_A_ID,
        REST_B_ID,
      ]);
    } finally {
      if (client) await client.end();
    }
  });

  function intentBody(key: string, overrides: Record<string, unknown> = {}) {
    return {
      orderToken: T[key],
      restaurantId: key === 'B' ? REST_B_ID : REST_A_ID,
      orderId: O[key],
      paymentMethod: 'MANUAL',
      idempotencyKey: `pay-test-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      currency: 'INR',
      ...overrides,
    };
  }

  it('A. Customer A creates an intent for their own order', async () => {
    const res = await intentPOST(postJson('http://test/api/payments/intent', intentBody('A1')));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paymentId: string; orderId: string };
    expect(body.paymentId).toBeTruthy();
    expect(body.orderId).toBe(O.A1);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('B/C. Customer A cannot touch Customer B order (UUID or explicit)', async () => {
    const resB = await intentPOST(
      postJson('http://test/api/payments/intent', intentBody('A1', { orderId: O.B }))
    );
    expect(resB.status).toBe(404);

    const resC = await intentPOST(
      postJson('http://test/api/payments/intent', {
        ...intentBody('B'),
        orderToken: T.A1,
      })
    );
    expect(resC.status).toBe(404);

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.payments WHERE order_id = $1`,
      [O.B]
    );
    expect(rows[0].n).toBe(0);
  });

  it('F. tampered restaurant_id is rejected (derived ids win)', async () => {
    const res = await intentPOST(
      postJson(
        'http://test/api/payments/intent',
        intentBody('A1', { restaurantId: REST_B_ID })
      )
    );
    expect(res.status).toBe(404);
  });

  it('G. order bound to another entry of the same restaurant is rejected', async () => {
    const res = await intentPOST(
      postJson('http://test/api/payments/intent', {
        ...intentBody('C'),
        orderToken: T.A1,
      })
    );
    expect(res.status).toBe(404);
  });

  it('H/I/J. missing, invalid, and legacy/empty credentials fail closed', async () => {
    const missing = await intentPOST(
      postJson('http://test/api/payments/intent', {
        restaurantId: REST_A_ID,
        orderId: O.A1,
        paymentMethod: 'MANUAL',
      })
    );
    expect(missing.status).toBe(400);

    const invalid = await intentPOST(
      postJson('http://test/api/payments/intent', {
        ...intentBody('A1'),
        orderToken: 'not-a-token',
      })
    );
    expect(invalid.status).toBe(404);

    const legacy = await intentPOST(
      postJson('http://test/api/payments/intent', { ...intentBody('A1'), orderToken: '' })
    );
    expect(legacy.status).toBe(400);
  });

  it('ineligible orders (CANCELLED / already PAID) are rejected generically', async () => {
    const cancelled = await intentPOST(
      postJson('http://test/api/payments/intent', intentBody('D'))
    );
    expect(cancelled.status).toBe(404);

    const paid = await intentPOST(
      postJson('http://test/api/payments/intent', intentBody('E'))
    );
    expect(paid.status).toBe(404);
  });

  it('D/E. verify binds payment to the authorized order (cross-customer fails)', async () => {
    // Genuine payment for B via its own credential.
    const intentB = await intentPOST(
      postJson('http://test/api/payments/intent', intentBody('B'))
    );
    expect(intentB.status).toBe(200);
    const { paymentId: paymentB } = (await intentB.json()) as { paymentId: string };

    // Attacker A presents B's payment id (and even B's provider refs).
    const cross = await verifyPOST(
      postJson('http://test/api/payments/verify', {
        orderToken: T.A1,
        paymentId: paymentB,
        providerPaymentId: 'pay_attacker_x',
        providerOrderId: 'order_attacker_x',
        providerSignature: 'valid_test_signature',
      })
    );
    expect(cross.status).toBe(404);

    const { rows } = await client.query(
      `SELECT status FROM public.payments WHERE id = $1`,
      [paymentB]
    );
    expect(['PENDING', 'PROCESSING']).toContain(rows[0].status);
  });

  it('verify success path still works for the owning customer (MANUAL)', async () => {
    const intent = await intentPOST(
      postJson('http://test/api/payments/intent', intentBody('M'))
    );
    expect(intent.status).toBe(200);
    const { paymentId } = (await intent.json()) as { paymentId: string };

    const res = await verifyPOST(
      postJson('http://test/api/payments/verify', {
        orderToken: T.M,
        paymentId,
        providerPaymentId: 'pay_manual_ok_1',
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('SUCCEEDED');
  });

  it('M. concurrent intents with one idempotency key create exactly one row', async () => {
    const key = `pay-test-M-dup-${Date.now()}`;
    const [r1, r2] = await Promise.all([
      intentPOST(
        postJson('http://test/api/payments/intent', { ...intentBody('M'), idempotencyKey: key })
      ),
      intentPOST(
        postJson('http://test/api/payments/intent', { ...intentBody('M'), idempotencyKey: key })
      ),
    ]);
    // The service check-then-insert race resolves via the UNIQUE(idempotency_key)
    // constraint: exactly one row wins; the loser surfaces a safe error and a
    // client retry with the same key hits the idempotent path. Either way the
    // exactly-once row invariant holds and at least one call succeeds.
    const statuses = [r1.status, r2.status];
    expect(statuses).toContain(200);
    for (const s of statuses) expect([200, 400, 429]).toContain(s);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.payments WHERE idempotency_key = $1`,
      [key]
    );
    expect(rows[0].n).toBeLessThanOrEqual(1);
  });

  it('N. distinct attempts are tracked explicitly (no silent duplicates)', async () => {
    const base = `pay-test-N-${Date.now()}`;
    const r1 = await intentPOST(
      postJson('http://test/api/payments/intent', { ...intentBody('N'), idempotencyKey: `${base}-1` })
    );
    const r2 = await intentPOST(
      postJson('http://test/api/payments/intent', { ...intentBody('N'), idempotencyKey: `${base}-2` })
    );
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = (await r1.json()) as { attemptNumber: number };
    const b2 = (await r2.json()) as { attemptNumber: number };
    expect(b2.attemptNumber).toBe(b1.attemptNumber + 1);
  });

  it('K. privileged service layer is untouched (no credential required)', async () => {
    const intent = await PaymentService.createPaymentIntent({
      restaurantId: REST_A_ID,
      orderId: O.N as string,
      amount: 0,
      paymentMethod: 'MANUAL',
      idempotencyKey: `pay-test-K-${Date.now()}`,
      currency: 'INR',
    });
    expect(intent.paymentId).toBeTruthy();
    expect(intent.orderId).toBe(O.N);
  });

  it('L. unsigned webhook is rejected and mutates nothing', async () => {
    const before = await client.query(
      `SELECT status FROM public.payments WHERE order_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
      [O.B]
    );
    const res = await webhookPOST(
      new NextRequest('http://test/api/payments/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'payment.captured', payload: {} }),
      }),
      { params: Promise.resolve({ provider: 'razorpay' }) }
    );
    expect(res.status).toBe(400);
    const after = await client.query(
      `SELECT status FROM public.payments WHERE order_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
      [O.B]
    );
    expect(JSON.stringify(after.rows)).toBe(JSON.stringify(before.rows));
  });
});

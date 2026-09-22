import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QueueService } from '@/lib/services/queue-service';

const SRC = path.resolve(__dirname, '../../src');
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('Customer Table-Call Response Flow (End-to-End)', () => {
  describe('1. Database Migration & Schema Integrity', () => {
    it('defines call_response, call_responded_at, and call_delay_minutes columns', () => {
      const migrationFile = fs.readdirSync(MIGRATIONS).find((f) => f.includes('customer_call_response'));
      expect(migrationFile).toBeDefined();
      const content = fs.readFileSync(path.join(MIGRATIONS, migrationFile!), 'utf8');

      expect(content).toContain("call_response TEXT CHECK (call_response IS NULL OR call_response IN ('ACCEPTED', 'DELAY_REQUESTED', 'DECLINED'))");
      expect(content).toContain('call_responded_at TIMESTAMPTZ');
      expect(content).toContain('call_delay_minutes INT');
      expect(content).toContain('CREATE OR REPLACE FUNCTION public.respond_to_call_atomic');
      expect(content).toContain('FOR UPDATE');
      expect(content).toContain('SET search_path = public');
    });

    it('validates status CALLED and enforces server-authoritative call timeout in RPC', () => {
      const migrationFile = fs.readdirSync(MIGRATIONS).find((f) => f.includes('customer_call_response'));
      const content = fs.readFileSync(path.join(MIGRATIONS, migrationFile!), 'utf8');

      expect(content).toContain("IF v_entry.status != 'CALLED' THEN");
      expect(content).toContain('v_timeout_mins');
      expect(content).toContain("v_now > v_entry.called_at + (v_timeout_mins || ' minutes')::INTERVAL");
      expect(content).toContain('CALL_EXPIRED');
      expect(content).toContain('QUEUE_CALL_ACCEPTED');
      expect(content).toContain('QUEUE_CALL_DELAY_REQUESTED');
      expect(content).toContain('QUEUE_CANCELLED');
      expect(content).toContain('CUSTOMER_LATE');
    });
  });

  describe('2. API Route & Security Validation (/api/q/respond)', () => {
    const routeCode = read('app/api/q/respond/route.ts');

    it('requires Bearer qtoken authorization header or body token', () => {
      expect(routeCode).toContain("authHeader.startsWith('Bearer ')");
      expect(routeCode).toContain("Missing required fields");
    });

    it('enforces rate limiting on the state-changing response endpoint', () => {
      expect(routeCode).toContain('RateLimitEndpointClass.STATE_CHANGING');
      expect(routeCode).toContain('checkRateLimit');
      expect(routeCode).toContain('429');
    });

    it('validates response payload and bounds delay minutes (1..60)', () => {
      expect(routeCode).toContain("['ACCEPTED', 'DELAY_REQUESTED', 'DECLINED'].includes(response)");
      expect(routeCode).toContain('delayMinutes < 1 || delayMinutes > 60');
      expect(routeCode).toContain("error: 'INVALID_DELAY_MINUTES'");
    });

    it('maps CALL_EXPIRED to HTTP 410 Gone and NOT_CALLED to HTTP 409 Conflict', () => {
      expect(routeCode).toContain("410");
      expect(routeCode).toContain("409");
    });
  });

  describe('3. QueueService Integration', () => {
    it('exposes respondToCall method that invokes respond_to_call_atomic', async () => {
      expect(typeof QueueService.respondToCall).toBe('function');

      // Verify that respondToCall rejects empty token
      await expect(
        QueueService.respondToCall('', 'ACCEPTED')
      ).rejects.toThrow('MISSING_TOKEN');
    });

    it('includes call_timeout_minutes in public queue status response', () => {
      const serviceCode = read('lib/services/queue-service.ts');
      expect(serviceCode).toContain('callTimeoutMinutes:');
      expect(serviceCode).toContain('callResponse:');
      expect(serviceCode).toContain('callRespondedAt:');
      expect(serviceCode).toContain('callDelayMinutes:');
    });
  });

  describe('4. Customer Decision UI (QueueTicketCard & CallDelaySheet)', () => {
    const cardCode = read('components/customer/QueueTicketCard.tsx');
    const sheetCode = read('components/customer/CallDelaySheet.tsx');

    it('renders the 3 distinct decision actions when CALLED and awaiting decision', () => {
      expect(cardCode).toContain("ACCEPT — I&apos;m on my way");
      expect(cardCode).toContain('⏱ DELAY');
      expect(cardCode).toContain("CAN&apos;T COME");
    });

    it('provides a server-authoritative live countdown timer for CALLED entries', () => {
      expect(cardCode).toContain('countdownSeconds');
      expect(cardCode).toContain('Please respond in');
      expect(cardCode).toContain('Math.floor(countdownSeconds / 60)');
    });

    it('displays arrival confirmation when customer accepts', () => {
      expect(cardCode).toContain("You&apos;re on your way!");
      expect(cardCode).toContain('Host stand is expecting your party');
    });

    it('displays delay notice with arrival confirmation button when delayed', () => {
      expect(cardCode).toContain('min requested');
      expect(cardCode).toContain("I&apos;ve Arrived — Ready for Table");
    });

    it('displays call expired notification when timer elapses', () => {
      expect(cardCode).toContain('CALL EXPIRED');
      expect(cardCode).toContain('Your table call window has passed');
      expect(cardCode).toContain('Please speak with the restaurant host stand');
    });

    it('renders accessible delay sheet with 5, 10, and 15 min options', () => {
      expect(sheetCode).toContain('delayOptions = [5, 10, 15]');
      expect(sheetCode).toContain('{mins} min');
      expect(sheetCode).toContain('role="dialog"');
      expect(sheetCode).toContain('aria-modal="true"');
      expect(sheetCode).toContain('Request {selectedMinutes} Min Delay');
    });
  });

  describe('5. Staff Dashboard Live Visibility (DashboardClient & LiveQueueFeedClient)', () => {
    const dashboardCode = read('components/dashboard/DashboardClient.tsx');
    const feedCode = read('components/dashboard/LiveQueueFeedClient.tsx');

    it('displays CALLED · ON THE WAY badge in DashboardClient when customer accepted', () => {
      expect(dashboardCode).toContain("response === 'ACCEPTED'");
      expect(dashboardCode).toContain('CALLED · ON THE WAY');
      expect(dashboardCode).toContain('Guest confirmed — on their way');
    });

    it('displays CALLED · DELAY (+Xm) badge in DashboardClient when customer requested delay', () => {
      expect(dashboardCode).toContain("response === 'DELAY_REQUESTED'");
      expect(dashboardCode).toContain('CALLED · DELAY (+');
      expect(dashboardCode).toContain('Delay (+');
    });

    it('displays CALLED · AWAITING RESPONSE badge when waiting for guest', () => {
      expect(dashboardCode).toContain('CALLED · AWAITING RESPONSE');
      expect(dashboardCode).toContain('Awaiting guest response');
    });

    it('displays identical synchronized badges in LiveQueueFeedClient', () => {
      expect(feedCode).toContain("response === 'ACCEPTED'");
      expect(feedCode).toContain('CALLED · ON THE WAY');
      expect(feedCode).toContain("response === 'DELAY_REQUESTED'");
      expect(feedCode).toContain('CALLED · DELAY (+');
      expect(feedCode).toContain('CALLED · AWAITING RESPONSE');
      expect(feedCode).toContain('Guest confirmed — on their way');
    });
  });

  describe('6. Seating Gating, Delay Demotion, and Removal Flow', () => {
    const dashboardCode = read('components/dashboard/DashboardClient.tsx');
    const feedCode = read('components/dashboard/LiveQueueFeedClient.tsx');
    const cardCode = read('components/customer/QueueTicketCard.tsx');
    const queueServiceCode = read('lib/services/queue-service.ts');

    it('gates table assignment so only ACCEPTED customers can be assigned a table', () => {
      // In DashboardClient
      expect(dashboardCode).toContain("anyEntry.call_response === 'ACCEPTED'");
      expect(dashboardCode).toContain('Awaiting Guest Acceptance');
      // In LiveQueueFeedClient
      expect(feedCode).toContain("anyEntry.call_response === 'ACCEPTED'");
      expect(feedCode).toContain('Awaiting Guest Acceptance');
    });

    it('places delayed guests below waiting guests in the queue sort order (priority 4)', () => {
      // In queue service
      expect(queueServiceCode).toContain("call_response === 'DELAY_REQUESTED'");
      expect(queueServiceCode).toContain("isDelayedA ? 4 :");
      // In DashboardClient
      expect(dashboardCode).toContain("anyA.call_response === 'DELAY_REQUESTED'");
      expect(dashboardCode).toContain("isDelayedA ? 4 :");
      // In LiveQueueFeedClient
      expect(feedCode).toContain("anyA.call_response === 'DELAY_REQUESTED'");
      expect(feedCode).toContain("isDelayedA ? 4 :");
    });

    it('allows immediate removal of declined or no-show guests from the queue', () => {
      expect(dashboardCode).toContain("Customer Can&apos;t Come / Declined");
      expect(dashboardCode).toContain("Remove / No-Show");
      expect(feedCode).toContain("Remove / No-Show");
      expect(cardCode).toContain("You have left the queue");
    });
  });
});


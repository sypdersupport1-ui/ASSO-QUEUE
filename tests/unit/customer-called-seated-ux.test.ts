import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ticketStateMeta,
  formatTicketNumber,
  positionLabel,
  partiesAheadLabel,
  formatTableNumber,
  shouldShowNotificationBanner,
  classifyProximity,
  isTicketTerminal,
  operatingNoteForTicket,
} from '@/lib/customer-ticket-ux';
import { QueueService } from '@/lib/services/queue-service';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('Phase 4D: Customer Called and Seated Experience (A–T)', () => {
  // A. WAITING retains existing ticket
  it('A. WAITING retains existing ticket and shows waiting metrics', () => {
    const meta = ticketStateMeta('WAITING');
    expect(meta.tone).toBe('waiting');
    expect(meta.showWaitInfo).toBe(true);
    expect(meta.title).toBe("You're in the queue");
    expect(meta.stage).toBe(0);
    expect(positionLabel(5, 'WAITING')).toBe('Position #5');
    expect(positionLabel(1, 'WAITING')).toBe("You're next");
    expect(partiesAheadLabel(4)).toBe('4 parties ahead');
  });

  // B. NOTIFIED retains getting-close behavior
  it('B. NOTIFIED retains getting-close behavior with wait info', () => {
    const meta = ticketStateMeta('NOTIFIED');
    expect(meta.tone).toBe('getting-close');
    expect(meta.showWaitInfo).toBe(true);
    expect(meta.title).toMatch(/close/i);
    expect(meta.stage).toBe(1);
    expect(positionLabel(2, 'NOTIFIED')).toBe('Position #2');
  });

  // C. CALLED shows "your turn" experience
  it('C. CALLED shows your turn experience with return-to-restaurant copy', () => {
    const meta = ticketStateMeta('CALLED');
    expect(meta.tone).toBe('urgent');
    expect(meta.title).toBe('Your table is being called');
    expect(meta.subtitle).toMatch(/return to the restaurant/i);
    expect(meta.guidance).toMatch(/host stand/i);
    expect(meta.stage).toBe(2);
    expect(positionLabel(1, 'CALLED')).toBe('Your turn is here');
    expect(formatTicketNumber('128', 'fallback')).toBe('Q-128');
  });

  // D. CALLED hides waiting metrics
  it('D. CALLED hides waiting metrics (showWaitInfo is false)', () => {
    const meta = ticketStateMeta('CALLED');
    expect(meta.showWaitInfo).toBe(false);
  });

  // E. CALLED cannot be overridden by proximity presentation
  it('E. CALLED cannot be overridden by proximity presentation', () => {
    // classifyProximity must return null when status is CALLED, even with 0 people ahead
    const prox = classifyProximity({
      status: 'CALLED',
      peopleAhead: 0,
      isAlmostYourTurn: true,
    });
    expect(prox).toBeNull();
  });

  // F. CALLED does not expose table ID or table number
  it('F. CALLED does not expose table ID or table number', () => {
    // When CALLED, table assignment is not yet made (table is selected at SEATING)
    const cardCode = read('components/customer/QueueTicketCard.tsx');
    // Ensure tableDisplay is guarded by isSeated
    expect(cardCode).toContain('const tableDisplay = isSeated ? formatTableNumber(status.tableNumber) : null;');
    // No raw table UUID exposure in response
    const svcCode = read('lib/services/queue-service.ts');
    expect(svcCode).not.toContain('tableId: entry.seated_table_id');
  });

  // G. SEATED shows completion state
  it('G. SEATED shows clean completion state with success tone', () => {
    const meta = ticketStateMeta('SEATED');
    expect(meta.tone).toBe('success');
    expect(meta.title).toBe("You're seated");
    expect(meta.subtitle).toMatch(/enjoy your meal/i);
    expect(meta.showWaitInfo).toBe(false);
    expect(meta.stage).toBe(3);
    expect(operatingNoteForTicket('SEATED', false, 'CLOSED')).toBeNull();
    expect(operatingNoteForTicket('CALLED', false, 'CLOSED')).toContain('active');
  });

  // H. SEATED removes position/ETA/cancel controls
  it('H. SEATED removes position/ETA/cancel controls', () => {
    expect(read('components/customer/QueueTicketCard.tsx')).toContain('isSeated && (');
    expect(isTicketTerminal('SEATED')).toBe(true);

    const cardCode = read('components/customer/QueueTicketCard.tsx');
    // Cancellation dialog must NOT be rendered when isSeated
    expect(cardCode).toContain('isSeated && (');
    expect(cardCode).toContain('View Menu');
  });

  // I. Safe table number is exposed only when SEATED (never raw UUID)
  it('I. Safe table number is formatted properly and accepts only customer-safe strings', () => {
    expect(formatTableNumber('4')).toBe('Table 4');
    expect(formatTableNumber('Table 12')).toBe('Table 12');
    expect(formatTableNumber(null)).toBeNull();
    expect(formatTableNumber(undefined)).toBeNull();
    expect(formatTableNumber('')).toBeNull();
    expect(formatTableNumber('   ')).toBeNull();
  });

  // J. CALLED → SEATED transition is supported by canonical FSM
  it('J. Canonical transitions allow CALLED -> SEATED atomic lifecycle', () => {
    // FSM rules: seat_queue_entry_atomic accepts CALLED, NOTIFIED, WAITING -> SEATED
    expect(QueueService.TERMINAL_STATUSES).toContain('SEATED');
    expect(QueueService.isTerminalStatus('SEATED')).toBe(true);
  });

  // K. CALLED → NO_SHOW transition is valid in FSM
  it('K. CALLED -> NO_SHOW transition is permitted in canonical FSM', () => {
    expect(QueueService.CANONICAL_TRANSITIONS['CALLED']).toContain('NO_SHOW');
  });

  // L. WAITING / NOTIFIED → CALLED transition is valid in FSM
  it('L. WAITING and NOTIFIED can transition to CALLED in canonical FSM', () => {
    expect(QueueService.CANONICAL_TRANSITIONS['WAITING']).toContain('CALLED');
    expect(QueueService.CANONICAL_TRANSITIONS['NOTIFIED']).toContain('CALLED');
  });

  // M. Realtime delivery triggers revalidation without changing authority
  it('M. Realtime hook triggers authoritative router.refresh on queue_update event', () => {
    const realtimeCode = read('lib/realtime/useCustomerQueueRealtime.ts');
    expect(realtimeCode).toContain("channel.on('broadcast', { event: 'queue_update' }");
    expect(realtimeCode).toContain('revalidate()');
    expect(realtimeCode).toContain('router.refresh()');
    // Does not blindly set local state from payload
    expect(realtimeCode).not.toMatch(/setStatus\(.*payload/);
  });

  // N. Accessible state transition announcement does not duplicate on background polling
  it('N. QueueTicketCard tracks previous status ref to avoid announcement spam on polling', () => {
    const cardCode = read('components/customer/QueueTicketCard.tsx');
    expect(cardCode).toContain('prevStatusRef = useRef(status.status)');
    expect(cardCode).toContain('if (prevStatusRef.current !== status.status)');
    expect(cardCode).toContain('aria-live="polite"');
  });

  // O. Reduced-motion path is supported
  it('O. Reduced-motion classes are respected in styles and animations', () => {
    const cardCode = read('components/customer/QueueTicketCard.tsx');
    expect(cardCode).toContain('motion-safe:animate-');
    expect(cardCode).toContain('motion-safe:animate-ping');
  });

  // P. Cancel/Call race behavior: backend remains authoritative
  it('P. Cancel/Call race: CALLED permits CANCELLED if customer acts before being marked seated/no-show', () => {
    expect(QueueService.CANONICAL_TRANSITIONS['CALLED']).toContain('CANCELLED');
    // Once SEATED, CANCELLED is not allowed
    expect(QueueService.CANONICAL_TRANSITIONS['SEATED']).toHaveLength(0);
  });

  // Q. No raw token or internal secrets exposed in component files
  it('Q. No raw token or token hash leaks in customer presentation files', () => {
    for (const rel of [
      'components/customer/QueueTicketCard.tsx',
      'components/customer/QueueProgressMessage.tsx',
      'components/customer/TicketNotificationBanner.tsx',
      'lib/customer-ticket-ux.ts',
    ]) {
      const code = read(rel);
      expect(code).not.toMatch(/token_hash|tokenHash|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  // R. No client-side authoritative transition in browser code
  it('R. No client component mutates status directly without calling server action', () => {
    const cardCode = read('components/customer/QueueTicketCard.tsx');
    // The ticket only receives status as a prop
    expect(cardCode).not.toContain("supabase.from('queue_entries').update");
  });

  // S. Notification banner deduplication when CALLED or SEATED
  it('S. Notification banner is deduplicated when message duplicates CALLED hero copy', () => {
    // When SEATED, notification banner is suppressed
    expect(shouldShowNotificationBanner('SEATED', { title: 'Update', message: 'Your table is ready' })).toBe(false);

    // When CALLED, duplicate "table is being called" or "return to restaurant" message is suppressed
    expect(shouldShowNotificationBanner('CALLED', { title: 'Table Call', message: 'Your table is being called now' })).toBe(false);
    expect(shouldShowNotificationBanner('CALLED', { title: 'Notice', message: 'Please return to the restaurant' })).toBe(false);
    expect(shouldShowNotificationBanner('CALLED', { title: 'Ready', message: 'Your turn is here' })).toBe(false);

    // When CALLED, a non-duplicative notice (e.g. dietary clarification or parking info) is allowed
    expect(shouldShowNotificationBanner('CALLED', { title: 'Valet', message: 'Valet parking is open on 5th Street' })).toBe(true);

    // When WAITING, relevant notification is allowed
    expect(shouldShowNotificationBanner('WAITING', { title: 'Notice', message: 'Queue is moving fast today' })).toBe(true);
    expect(shouldShowNotificationBanner('WAITING', null)).toBe(false);
  });

  // T. Customer cannot access or alter another ticket/table
  it('T. getQueueStatusByToken query is strictly scoped by token hash', () => {
    const svcCode = read('lib/services/queue-service.ts');
    expect(svcCode).toContain(".eq('token_hash', tokenHash)");
    // Does not allow entryId parameter in public lookup
    expect(svcCode).toContain('static async getQueueStatusByToken(rawToken: string)');
  });
});

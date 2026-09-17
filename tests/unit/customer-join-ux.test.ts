import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveJoinability,
  formatWaitLabel,
  validateJoinForm,
  isPlausiblePhone,
  normalizePhoneForSubmit,
  mapJoinErrorToUX,
} from '@/lib/customer-join-ux';

describe('Phase 4A: landing joinability follows authoritative backend state', () => {
  it('OPEN + enabled + scheduled open + capacity → joinable OPEN', () => {
    expect(
      resolveJoinability({
        queueEnabled: true,
        operatingState: 'OPEN',
        isFull: false,
        scheduledOpen: true,
      })
    ).toEqual({ canJoin: true, state: 'OPEN' });
  });

  it('CLOSING_SOON stays joinable with warning state', () => {
    expect(
      resolveJoinability({
        queueEnabled: true,
        operatingState: 'CLOSING_SOON',
        isFull: false,
        scheduledOpen: true,
      })
    ).toEqual({ canJoin: true, state: 'CLOSING_SOON' });
  });

  it('PAUSED blocks joining even with free capacity', () => {
    expect(
      resolveJoinability({
        queueEnabled: true,
        operatingState: 'PAUSED',
        isFull: false,
        scheduledOpen: true,
      }).canJoin
    ).toBe(false);
  });

  it('CLOSED blocks joining', () => {
    const r = resolveJoinability({
      queueEnabled: true,
      operatingState: 'CLOSED',
      isFull: false,
      scheduledOpen: true,
    });
    expect(r).toEqual({ canJoin: false, state: 'CLOSED' });
  });

  it('disabled queue reads as CLOSED', () => {
    expect(
      resolveJoinability({
        queueEnabled: false,
        operatingState: 'OPEN',
        isFull: false,
        scheduledOpen: true,
      })
    ).toEqual({ canJoin: false, state: 'CLOSED' });
  });

  it('outside scheduled hours reads as CLOSED with next-opening support', () => {
    expect(
      resolveJoinability({
        queueEnabled: true,
        operatingState: 'OPEN',
        isFull: false,
        scheduledOpen: false,
      })
    ).toEqual({ canJoin: false, state: 'CLOSED' });
  });

  it('FULL blocks joining and reports FULL state', () => {
    expect(
      resolveJoinability({
        queueEnabled: true,
        operatingState: 'OPEN',
        isFull: true,
        scheduledOpen: true,
      })
    ).toEqual({ canJoin: false, state: 'FULL' });
  });

  it('manual PAUSED wins over FULL (state precedence)', () => {
    expect(
      resolveJoinability({
        queueEnabled: true,
        operatingState: 'PAUSED',
        isFull: true,
        scheduledOpen: true,
      }).state
    ).toBe('PAUSED');
  });
});

describe('Phase 4A: ETA display never invents precision', () => {
  it('null/undefined/non-finite → graceful fallback, never "0 min"', () => {
    expect(formatWaitLabel(null)).toBe('Wait time updating');
    expect(formatWaitLabel(undefined)).toBe('Wait time updating');
    expect(formatWaitLabel(NaN)).toBe('Wait time updating');
    expect(formatWaitLabel(0)).not.toContain('0 min');
  });

  it('small waits render directly', () => {
    expect(formatWaitLabel(5)).toBe('~5 min');
    expect(formatWaitLabel(17)).toBe('~17 min');
  });

  it('larger waits round to nearest 5', () => {
    expect(formatWaitLabel(34)).toBe('~35 min');
    expect(formatWaitLabel(32)).toBe('~30 min');
  });

  it('hour-plus waits render hours', () => {
    expect(formatWaitLabel(60)).toBe('~1 hr');
    expect(formatWaitLabel(75)).toBe('~1 hr 15 min');
  });
});

describe('Phase 4A: join form validation mirrors backend contract', () => {
  const constraints = { minParty: 1, maxParty: 8 };

  it('accepts a valid form', () => {
    expect(
      validateJoinForm(
        { name: 'Rahul Sharma', phone: '98765 43210', partySize: 4 },
        constraints
      )
    ).toEqual({});
  });

  it('requires a name', () => {
    const errors = validateJoinForm(
      { name: '   ', phone: '', partySize: 2 },
      constraints
    );
    expect(errors.name).toBe('Please enter your name.');
  });

  it('phone is optional', () => {
    expect(
      validateJoinForm({ name: 'Asha', phone: '', partySize: 2 }, constraints)
    ).toEqual({});
  });

  it('accepts legitimate Indian formats without rejecting', () => {
    for (const phone of ['9876543210', '98765 43210', '+919876543210', '+91 98765 43210']) {
      expect(isPlausiblePhone(phone)).toBe(true);
      expect(
        validateJoinForm({ name: 'Asha', phone, partySize: 2 }, constraints).phone
      ).toBeUndefined();
    }
  });

  it('rejects obvious non-phones with a friendly message', () => {
    const errors = validateJoinForm(
      { name: 'Asha', phone: 'abc', partySize: 2 },
      constraints
    );
    expect(errors.phone).toBe('Please enter a valid phone number.');
  });

  it('enforces the restaurant party-size range', () => {
    expect(
      validateJoinForm({ name: 'Asha', phone: '', partySize: 0 }, constraints)
        .partySize
    ).toBe('Party size must be between 1 and 8.');
    expect(
      validateJoinForm({ name: 'Asha', phone: '', partySize: 9 }, constraints)
        .partySize
    ).toBe('Party size must be between 1 and 8.');
  });
});

describe('Phase 4A: phone submit normalization preserves duplicate guard', () => {
  it('trims only — never strips country codes or spacing', () => {
    expect(normalizePhoneForSubmit('  +91 98765 43210  ')).toBe('+91 98765 43210');
    expect(normalizePhoneForSubmit('98765 43210')).toBe('98765 43210');
  });
});

describe('Phase 4A: join error UX matrix stays human-friendly', () => {
  it('maps every known backend state to title + body + next step', () => {
    const cases: Array<[string, string]> = [
      ['The queue is currently full. Please try again shortly.', 'Queue is full'],
      ['The queue is temporarily paused. Please check back shortly.', 'Queue temporarily paused'],
      ['The queue is currently closed. Please check the operating hours and try again later.', 'Queue currently closed'],
      ['You are already waiting in line for this restaurant! Check your existing ticket.', "You're already in line"],
      ['The selected party size is not accepted by this restaurant.', 'Check your details'],
      ['Too many requests. Please try again shortly.', 'Please wait a moment'],
      ['Failed to join queue. Please try again.', 'Something went wrong'],
    ];
    for (const [input, expectedTitle] of cases) {
      const ux = mapJoinErrorToUX(input);
      expect(ux.title).toBe(expectedTitle);
      expect(ux.body.length).toBeGreaterThan(0);
    }
  });

  it('duplicate-phone message never reveals other-customer data', () => {
    const ux = mapJoinErrorToUX('DUPLICATE_ACTIVE_ENTRY');
    expect(ux.kind).toBe('DUPLICATE_ACTIVE_PHONE');
    expect(ux.body).not.toMatch(/@|select|rpc|token/i);
  });
});

describe('Phase 4A: customer landing never touches browser JS token storage', () => {
  const customerDir = path.resolve(__dirname, '../../src/components/customer');
  const files = [
    'QueueJoinForm.tsx',
    'QueueStatusCard.tsx',
    'PartySizeSelector.tsx',
    'RestaurantHeader.tsx',
    'LandingAutoRefresh.tsx',
    'CustomerErrorState.tsx',
    'CustomerPageSkeleton.tsx',
  ];

  for (const file of files) {
    it(`${file} contains no localStorage/sessionStorage`, () => {
      const src = fs.readFileSync(path.join(customerDir, file), 'utf8');
      expect(src).not.toMatch(/localStorage|sessionStorage/);
    });
  }

  it('landing page contains no browser token storage', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/app/q/[slug]/page.tsx'),
      'utf8'
    );
    expect(src).not.toMatch(/localStorage|sessionStorage/);
  });
});

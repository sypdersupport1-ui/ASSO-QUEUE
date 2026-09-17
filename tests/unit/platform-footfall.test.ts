import { describe, it, expect } from 'vitest';
import {
  bucketKeyFor,
  bucketLabelFor,
  rangeKeys,
  aggregateFootfall,
} from '@/lib/services/platform-service';

describe('Platform footfall aggregation', () => {
  it('buckets timestamps by UTC day and month', () => {
    expect(bucketKeyFor('2026-09-15T18:30:00Z', 'day')).toBe('2026-09-15');
    expect(bucketKeyFor('2026-09-15T18:30:00Z', 'month')).toBe('2026-09');
    expect(bucketKeyFor('not-a-date', 'day')).toBeNull();
  });

  it('labels buckets in readable form', () => {
    expect(bucketLabelFor('2026-09', 'month')).toContain('2026');
    expect(bucketLabelFor('2026-09-15', 'day')).toContain('15');
  });

  it('fills gaps in ranges', () => {
    const keys = rangeKeys(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-03T23:59:59Z'), 'day');
    expect(keys).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    const months = rangeKeys(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-02T00:00:00Z'), 'month');
    expect(months).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('counts seated guests with actual_guests fallback to party_size', () => {
    const { buckets, byRestaurant, totals } = aggregateFootfall(
      [
        { restaurantId: 'r1', restaurantName: 'A', partySize: 4, actualGuests: 3, at: '2026-09-15T10:00:00Z' },
        { restaurantId: 'r1', restaurantName: 'A', partySize: 2, actualGuests: null, at: '2026-09-15T12:00:00Z' },
      ],
      [{ restaurantId: 'r1', total: 500, at: '2026-09-15T11:00:00Z' }],
      'day',
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-15T23:59:59Z')
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ groups: 2, guests: 5, expected: 6, orders: 1, revenue: 500 });
    expect(byRestaurant).toHaveLength(1);
    expect(byRestaurant[0]).toMatchObject({ restaurantName: 'A', groups: 2, guests: 5 });
    expect(totals).toMatchObject({ groups: 2, guests: 5, expected: 6, orders: 1, revenue: 500 });
  });

  it('keeps empty days as zero rows (no gaps)', () => {
    const { buckets } = aggregateFootfall(
      [],
      [],
      'day',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-03T23:59:59Z')
    );
    expect(buckets.map((b) => b.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(buckets.every((b) => b.guests === 0)).toBe(true);
  });

  it('sorts restaurants by guests descending', () => {
    const { byRestaurant } = aggregateFootfall(
      [
        { restaurantId: 'r1', restaurantName: 'Small', partySize: 1, actualGuests: 1, at: '2026-09-15T10:00:00Z' },
        { restaurantId: 'r2', restaurantName: 'Big', partySize: 8, actualGuests: 8, at: '2026-09-15T10:00:00Z' },
      ],
      [],
      'day',
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-15T23:59:59Z')
    );
    expect(byRestaurant[0]?.restaurantName).toBe('Big');
  });
});

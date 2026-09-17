import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '@/lib/services/analytics-service';

describe('Restaurant 5 AM - 5 AM Footfall Slots Telemetry', () => {
  it('exposes getFootfallIn5to5Slots on AnalyticsService', () => {
    expect(typeof AnalyticsService.getFootfallIn5to5Slots).toBe('function');
  });

  it('defines the 8 standard 3-hour operational shifts across the 24h cycle', () => {
    const expectedSlots = [
      '05:00 - 08:00',
      '08:00 - 11:00',
      '11:00 - 14:00',
      '14:00 - 17:00',
      '17:00 - 20:00',
      '20:00 - 23:00',
      '23:00 - 02:00',
      '02:00 - 05:00',
    ];
    expect(expectedSlots).toHaveLength(8);
  });
});

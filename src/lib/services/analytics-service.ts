import 'server-only';
import { createServerClient } from '@/lib/db/supabase/server';

export interface QueueMetricsSummary {
  total_joined: number;
  total_seated: number;
  total_dropped: number;
  avg_wait_time_seconds: number;
}

export interface HourlyQueueVolume {
  hour: string;
  count: number;
}

export interface CommerceMetricsSummary {
  total_orders: number;
  total_revenue: number;
}

export interface FootfallSlot {
  slotKey: string;
  label: string;
  startTime: string;
  endTime: string;
  totalGuests: number;
  seatedGuests: number;
  partyCount: number;
  isCurrent: boolean;
  isPeak: boolean;
}

export interface ShiftFootfallReport {
  shiftDate: string;
  cutoffISO: string;
  nextCutoffISO: string;
  totalFootfall: number;
  totalSeatedFootfall: number;
  totalParties: number;
  seatedConversionRate: number;
  peakSlot: FootfallSlot | null;
  currentSlot: FootfallSlot | null;
  slots: FootfallSlot[];
}

export class AnalyticsService {
  /**
   * Get queue metrics summary for a given time range
   */
  static async getQueueMetricsSummary(
    restaurantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<QueueMetricsSummary> {
    const supabase = await createServerClient();

    const { data, error } = await supabase.rpc('get_queue_metrics_summary', {
      p_restaurant_id: restaurantId,
      p_start_date: startDate.toISOString(),
      p_end_date: endDate.toISOString(),
    });

    if (error) {
      console.error('Failed to get queue metrics summary:', error);
      throw new Error(`Analytics Error: ${error.message}`);
    }

    return data as unknown as QueueMetricsSummary;
  }

  /**
   * Get hourly queue volume for a specific time range
   */
  static async getHourlyQueueVolume(
    restaurantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<HourlyQueueVolume[]> {
    const supabase = await createServerClient();

    const { data, error } = await supabase.rpc('get_hourly_queue_volume', {
      p_restaurant_id: restaurantId,
      p_start_date: startDate.toISOString(),
      p_end_date: endDate.toISOString(),
    });

    if (error) {
      console.error('Failed to get hourly queue volume:', error);
      throw new Error(`Analytics Error: ${error.message}`);
    }

    return data as unknown as HourlyQueueVolume[];
  }

  /**
   * Get commerce metrics summary for a given time range
   */
  static async getCommerceMetricsSummary(
    restaurantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CommerceMetricsSummary> {
    const supabase = await createServerClient();

    const { data, error } = await supabase.rpc('get_commerce_metrics_summary', {
      p_restaurant_id: restaurantId,
      p_start_date: startDate.toISOString(),
      p_end_date: endDate.toISOString(),
    });

    if (error) {
      console.error('Failed to get commerce metrics summary:', error);
      throw new Error(`Analytics Error: ${error.message}`);
    }

    return data as unknown as CommerceMetricsSummary;
  }

  /**
   * Calculates Footfall in 5 AM to 5 AM operating slots for today's restaurant shift.
   * Splits the 24-hour cycle into 8 standard service slots (5am-8am, 8am-11am, 11am-2pm, etc.).
   */
  static async getFootfallIn5to5Slots(
    restaurantId: string,
    timezone = 'UTC'
  ): Promise<ShiftFootfallReport> {
    const supabase = await createServerClient();

    // 1. Calculate 5 AM cutoff
    let cutoffDate: Date;
    try {
      const { data: cutoffData } = await supabase.rpc('get_recent_5am_cutoff', {
        p_timezone: timezone || 'UTC',
      });
      cutoffDate = cutoffData ? new Date(cutoffData) : new Date();
    } catch {
      cutoffDate = new Date();
    }

    // Ensure cutoff is rounded to the 5 AM start
    const cutoffMs = cutoffDate.getTime();
    const nextCutoffMs = cutoffMs + 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    // 2. Define 8 standard 3-hour operational slots across the 5 AM - 5 AM shift
    const slotDefinitions = [
      { key: '05:00 - 08:00', label: 'Early Shift', offsetHours: 0 },
      { key: '08:00 - 11:00', label: 'Breakfast & Morning', offsetHours: 3 },
      { key: '11:00 - 14:00', label: 'Lunch Rush', offsetHours: 6 },
      { key: '14:00 - 17:00', label: 'Afternoon Service', offsetHours: 9 },
      { key: '17:00 - 20:00', label: 'Prime Dinner Rush', offsetHours: 12 },
      { key: '20:00 - 23:00', label: 'Late Evening', offsetHours: 15 },
      { key: '23:00 - 02:00', label: 'Night Lounge', offsetHours: 18 },
      { key: '02:00 - 05:00', label: 'Late Night / Closing', offsetHours: 21 },
    ];

    const slots: FootfallSlot[] = slotDefinitions.map((def) => {
      const slotStart = new Date(cutoffMs + def.offsetHours * 3600 * 1000);
      const slotEnd = new Date(cutoffMs + (def.offsetHours + 3) * 3600 * 1000);
      const isCurrent = nowMs >= slotStart.getTime() && nowMs < slotEnd.getTime();

      return {
        slotKey: def.key,
        label: def.label,
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        totalGuests: 0,
        seatedGuests: 0,
        partyCount: 0,
        isCurrent,
        isPeak: false,
      };
    });

    // 3. Query all queue entries in this 5 AM to 5 AM shift
    const { data: entries } = await supabase
      .from('queue_entries')
      .select('id, party_size, actual_guests, status, joined_at, seated_at, created_at')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', new Date(cutoffMs).toISOString())
      .lt('created_at', new Date(nextCutoffMs).toISOString());

    const records = entries || [];

    for (const entry of records) {
      const entryTime = new Date(entry.joined_at || entry.created_at).getTime();
      const guests = entry.actual_guests || entry.party_size || 1;
      const isSeated = entry.status === 'SEATED';

      // Match into slot
      for (const slot of slots) {
        const sTime = new Date(slot.startTime).getTime();
        const eTime = new Date(slot.endTime).getTime();
        if (entryTime >= sTime && entryTime < eTime) {
          slot.totalGuests += guests;
          slot.partyCount += 1;
          if (isSeated) {
            slot.seatedGuests += guests;
          }
          break;
        }
      }
    }

    // 4. Determine Peak Slot
    let maxGuests = 0;
    let peakSlot: FootfallSlot | null = null;
    for (const slot of slots) {
      if (slot.totalGuests > maxGuests) {
        maxGuests = slot.totalGuests;
        peakSlot = slot;
      }
    }
    if (peakSlot && maxGuests > 0) {
      peakSlot.isPeak = true;
    }

    const currentSlot = slots.find((s) => s.isCurrent) || null;
    const totalFootfall = slots.reduce((acc, s) => acc + s.totalGuests, 0);
    const totalSeatedFootfall = slots.reduce((acc, s) => acc + s.seatedGuests, 0);
    const totalParties = slots.reduce((acc, s) => acc + s.partyCount, 0);
    const seatedConversionRate = totalFootfall > 0 ? Math.round((totalSeatedFootfall / totalFootfall) * 100) : 0;

    return {
      shiftDate: cutoffDate.toISOString().split('T')[0] || new Date().toISOString().split('T')[0] || '',
      cutoffISO: new Date(cutoffMs).toISOString(),
      nextCutoffISO: new Date(nextCutoffMs).toISOString(),
      totalFootfall,
      totalSeatedFootfall,
      totalParties,
      seatedConversionRate,
      peakSlot,
      currentSlot,
      slots,
    };
  }
}

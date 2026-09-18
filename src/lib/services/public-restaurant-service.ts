import { createAdminClient } from '@/lib/db/supabase/admin';
import { CacheService, CacheKeys } from '@/lib/cache';

export interface PublicRestaurantInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  logoUrl: string | null;
  queueEnabled: boolean;
  queueOperatingState: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
  maxQueueCapacity: number;
  minPartySize: number;
  maxPartySize: number;
  callTimeoutMinutes: number;
  status: string;
  // Phase 4G: ISO currency for customer price display (public, non-sensitive).
  currency: string;
  // Phase 4A: per-restaurant ETA tuning (non-sensitive operational config).
  // Lets the QR landing page use the authoritative ETAService formula
  // instead of inventing a client-side wait estimate.
  avgServiceTimeMins: number;
  serviceCapacityUnits: number;
  etaBufferMins: number;
  /** Phase 1 Takeaway: whether Takeaway queue is enabled for this restaurant. */
  takeawayEnabled: boolean;
  dineInCustomerOrderingEnabled: boolean;
  dineInStaffOrderingEnabled: boolean;
  takeawayCustomerOrderingEnabled: boolean;
  takeawayStaffOrderingEnabled: boolean;
}

export class PublicRestaurantService {
  /**
   * Resolves public restaurant information by slug for customer QR flows.
   */
  static async getPublicRestaurantBySlug(slug: string): Promise<PublicRestaurantInfo | null> {
    if (!slug) return null;

    return CacheService.getOrSet(
      CacheKeys.publicRestaurant(slug),
      async () => {
        const supabase = createAdminClient();

        const { data: restaurant, error } = await supabase
          .from('restaurants')
          .select('id, name, slug, description, phone, address, city, logo_url, queue_enabled, queue_operating_state, max_queue_capacity, min_party_size, max_party_size, call_timeout_minutes, status, currency, avg_service_time_mins, service_capacity_units, eta_buffer_mins, takeaway_enabled, dine_in_customer_ordering_enabled, dine_in_staff_ordering_enabled, takeaway_customer_ordering_enabled, takeaway_staff_ordering_enabled')
          .eq('slug', slug.trim().toLowerCase())
          .eq('status', 'ACTIVE')
          .maybeSingle();

        if (error || !restaurant) {
          return null;
        }

        const raw = restaurant as unknown as {
          queue_operating_state?: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
          currency?: string;
          takeaway_enabled?: boolean;
          dine_in_customer_ordering_enabled?: boolean;
          dine_in_staff_ordering_enabled?: boolean;
          takeaway_customer_ordering_enabled?: boolean;
          takeaway_staff_ordering_enabled?: boolean;
        };

        return {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          description: restaurant.description,
          phone: restaurant.phone,
          address: restaurant.address,
          city: restaurant.city,
          logoUrl: restaurant.logo_url,
          queueEnabled: restaurant.queue_enabled,
          queueOperatingState: raw.queue_operating_state || 'OPEN',
          maxQueueCapacity: restaurant.max_queue_capacity,
          minPartySize: restaurant.min_party_size,
          maxPartySize: restaurant.max_party_size,
          callTimeoutMinutes: restaurant.call_timeout_minutes,
          status: restaurant.status,
          currency: raw.currency || 'INR',
          avgServiceTimeMins: restaurant.avg_service_time_mins ?? 15,
          serviceCapacityUnits: restaurant.service_capacity_units ?? 3,
          etaBufferMins: restaurant.eta_buffer_mins ?? 5,
          takeawayEnabled: raw.takeaway_enabled ?? false,
          dineInCustomerOrderingEnabled: raw.dine_in_customer_ordering_enabled ?? true,
          dineInStaffOrderingEnabled: raw.dine_in_staff_ordering_enabled ?? true,
          takeawayCustomerOrderingEnabled: raw.takeaway_customer_ordering_enabled ?? true,
          takeawayStaffOrderingEnabled: raw.takeaway_staff_ordering_enabled ?? true,
        };
      },
      300 // 5 minutes TTL
    );
  }

  /**
   * Fetches menu items for public customer preview while waiting.
   * Parallelized for snappiness.
   *
   * Phase 4G: exposes ONLY customer-safe fields (name, description, price,
   * image, prep estimate, availability). No inventory quantities, recipes,
   * SKUs, or internal IDs beyond the item/category UUIDs the order action
   * needs. Inactive/archived items are excluded; UNAVAILABLE items are
   * INCLUDED with their flag so the UI can honestly show "Unavailable"
   * instead of silently hiding dishes.
   */
  static async getPublicMenuPreview(restaurantId: string) {
    const supabase = createAdminClient();

    const [{ data: categories, error: catError }, { data: items, error: itemError }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, description, sort_order')
        .eq('restaurant_id', restaurantId)
        .eq('active', true)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true }),
      supabase
        .from('menu_items')
        .select('id, category_id, name, description, price, available, image_url, preparation_time_minutes, active')
        .eq('restaurant_id', restaurantId)
        .eq('active', true)
        .eq('is_archived', false)
        .order('name', { ascending: true }),
    ]);

    if (catError || !categories) return [];
    if (itemError || !items) return [];

    // Group items by category (unavailable items kept with their flag).
    return categories.map((cat) => ({
      ...cat,
      items: items.filter((item) => item.category_id === cat.id),
    })).filter((cat) => cat.items.length > 0);
  }
}

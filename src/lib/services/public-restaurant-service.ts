import { createAdminClient } from '@/lib/db/supabase/admin';
import { CacheService, CacheKeys } from '@/lib/cache';
import { logger } from '@/lib/logging/logger';

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
  takeawayManualOrderingEnabled: boolean;
  /** Phase 2 Customer Theme: active customer-facing presentation theme identifier (e.g. 'default'). */
  customerThemeKey: string;
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
        const baseFields =
          'id, name, slug, description, phone, address, city, logo_url, queue_enabled, queue_operating_state, max_queue_capacity, min_party_size, max_party_size, call_timeout_minutes, status, currency, avg_service_time_mins, service_capacity_units, eta_buffer_mins, takeaway_enabled, dine_in_customer_ordering_enabled, dine_in_staff_ordering_enabled, takeaway_customer_ordering_enabled, takeaway_staff_ordering_enabled, takeaway_manual_ordering_enabled';

        let restaurant: Record<string, unknown> | null = null;
        let queryError: { code: string; message: string; details?: string } | null = null;

        // Try selecting customer_theme_key along with base fields
        const primaryRes = await supabase
          .from('restaurants')
          .select(`${baseFields}, customer_theme_key`)
          .eq('slug', slug.trim().toLowerCase())
          .eq('status', 'ACTIVE')
          .maybeSingle();

        if (primaryRes.error) {
          // If remote migration has not yet added customer_theme_key (PostgreSQL code 42703: undefined_column),
          // gracefully fall back to base fields query so customer QR flows NEVER break.
          if (primaryRes.error.code === '42703') {
            logger.warn('Remote database schema missing customer_theme_key column; falling back to default theme', {
              operation: 'getPublicRestaurantBySlug',
              metadata: { slug },
            });
            const fallbackRes = await supabase
              .from('restaurants')
              .select(baseFields)
              .eq('slug', slug.trim().toLowerCase())
              .eq('status', 'ACTIVE')
              .maybeSingle();

            if (fallbackRes.error) {
              queryError = fallbackRes.error;
            } else {
              restaurant = fallbackRes.data as Record<string, unknown> | null;
            }
          } else {
            queryError = primaryRes.error;
          }
        } else {
          restaurant = primaryRes.data as Record<string, unknown> | null;
        }

        if (queryError) {
          logger.error('Database error fetching public restaurant by slug', {
            operation: 'getPublicRestaurantBySlug',
            metadata: {
              slug,
              code: queryError.code,
              message: queryError.message,
              details: queryError.details,
            },
          });
          throw new Error(`Database error fetching restaurant: ${queryError.message}`);
        }

        if (!restaurant) {
          return null;
        }

        const raw = restaurant as unknown as {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          phone: string | null;
          address: string | null;
          city: string | null;
          logo_url: string | null;
          queue_enabled: boolean;
          queue_operating_state?: 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';
          max_queue_capacity: number;
          min_party_size: number;
          max_party_size: number;
          call_timeout_minutes: number;
          status: string;
          currency?: string;
          avg_service_time_mins?: number;
          service_capacity_units?: number;
          eta_buffer_mins?: number;
          takeaway_enabled?: boolean;
          dine_in_customer_ordering_enabled?: boolean;
          dine_in_staff_ordering_enabled?: boolean;
          takeaway_customer_ordering_enabled?: boolean;
          takeaway_staff_ordering_enabled?: boolean;
          takeaway_manual_ordering_enabled?: boolean;
          customer_theme_key?: string;
        };

        return {
          id: raw.id,
          name: raw.name,
          slug: raw.slug,
          description: raw.description,
          phone: raw.phone,
          address: raw.address,
          city: raw.city,
          logoUrl: raw.logo_url,
          queueEnabled: raw.queue_enabled,
          queueOperatingState: raw.queue_operating_state || 'OPEN',
          maxQueueCapacity: raw.max_queue_capacity,
          minPartySize: raw.min_party_size,
          maxPartySize: raw.max_party_size,
          callTimeoutMinutes: raw.call_timeout_minutes,
          status: raw.status,
          currency: raw.currency || 'INR',
          avgServiceTimeMins: raw.avg_service_time_mins ?? 15,
          serviceCapacityUnits: raw.service_capacity_units ?? 3,
          etaBufferMins: raw.eta_buffer_mins ?? 5,
          takeawayEnabled: raw.takeaway_enabled ?? false,
          dineInCustomerOrderingEnabled: raw.dine_in_customer_ordering_enabled ?? true,
          dineInStaffOrderingEnabled: raw.dine_in_staff_ordering_enabled ?? true,
          takeawayCustomerOrderingEnabled: raw.takeaway_customer_ordering_enabled ?? true,
          takeawayStaffOrderingEnabled: raw.takeaway_staff_ordering_enabled ?? true,
          takeawayManualOrderingEnabled: raw.takeaway_manual_ordering_enabled ?? false,
          customerThemeKey: raw.customer_theme_key || 'default',
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

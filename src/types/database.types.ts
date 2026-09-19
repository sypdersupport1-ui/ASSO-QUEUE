export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RestaurantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type UserRoleType = 'SUPER_ADMIN' | 'RESTAURANT_ADMIN' | 'STAFF';
export type MembershipStatus = 'ACTIVE' | 'INACTIVE';
export type ZoneStatus = 'ACTIVE' | 'INACTIVE';
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING' | 'OUT_OF_SERVICE';
export type TableShape = 'ROUND' | 'SQUARE' | 'RECTANGLE' | 'BAR';
export type SeatingMode = 'SIMPLE' | 'STRICT';

/**
 * Phase 1 Takeaway: authoritative service type on queue_entries.
 * DINE_IN: classic seating-based queue (existing behavior).
 * TAKEAWAY: order/pickup queue — no table assignment, no seating semantics.
 * Immutable after queue entry creation.
 */
export type QueueType = 'DINE_IN' | 'TAKEAWAY';

/**
 * Authoritative QueueFlow queue entry FSM states.
 *
 * DINE_IN active states (can be transitioned from):
 *   WAITING  → NOTIFIED, CALLED, CANCELLED, EXPIRED
 *   NOTIFIED → CALLED, SEATED, CANCELLED, EXPIRED
 *   CALLED   → SEATED, NO_SHOW, CANCELLED, EXPIRED
 *
 * TAKEAWAY active states:
 *   WAITING  → CALLED, CANCELLED, EXPIRED
 *   CALLED   → COMPLETED (pickup confirmed), CANCELLED, EXPIRED
 *
 * DINE_IN terminal states:
 *   SEATED, CANCELLED, NO_SHOW, EXPIRED
 *
 * TAKEAWAY terminal states:
 *   COMPLETED (pickup confirmed), CANCELLED, NO_SHOW, EXPIRED
 *
 * Note: COMPLETED is used as the Takeaway pickup terminal state.
 * It also exists as a legacy alias in DINE_IN historical records.
 *
 * Legacy states (DINE_IN historical records only — not producible by new code for DINE_IN):
 *   REMOVED, SKIPPED
 *
 * Removed (fully deprecated — never use):
 *   CONFIRMED, ARRIVED  (Phase 2 legacy, superseded by Phase 8 constraint)
 */
export type QueueStatus =
  | 'WAITING'
  | 'CALLED'
  | 'NOTIFIED'
  | 'SEATED'
  | 'COMPLETED'   // Takeaway: pickup terminal state; DINE_IN: legacy historical only
  | 'CANCELLED'
  | 'REMOVED'     // legacy historical only
  | 'SKIPPED'     // legacy historical only
  | 'NO_SHOW'
  | 'EXPIRED';

/** Active (non-terminal) queue states */
export type ActiveQueueStatus = 'WAITING' | 'CALLED' | 'NOTIFIED';

/** Terminal queue states — no further transitions allowed */
export type TerminalQueueStatus = 'SEATED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED' | 'COMPLETED' | 'REMOVED' | 'SKIPPED';

/** States that are eligible for seating */
export type SeatableQueueStatus = 'WAITING' | 'CALLED' | 'NOTIFIED';

/**
 * Authoritative QueueFlow order FSM states.
 *
 * Operational FSM:
 *   DRAFT → PLACED → CONFIRMED → PREPARING → READY → SERVED
 *   Any non-terminal → CANCELLED
 *
 * Terminal states: SERVED, CANCELLED
 *
 * Legacy states (historical records only — new records restricted by DB constraint):
 *   PENDING, ACCEPTED, IN_PREPARATION, COMPLETED
 */
export type OrderStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

/** Legacy order statuses — may exist in historical records, cannot be set on new records */
export type LegacyOrderStatus = 'PENDING' | 'ACCEPTED' | 'IN_PREPARATION' | 'COMPLETED';

/** All order statuses including legacy */
export type AnyOrderStatus = OrderStatus | LegacyOrderStatus;

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUNDED';

/**
 * Payment transaction FSM states (on the payments table).
 *
 * Authoritative FSM:
 *   PENDING → PROCESSING → SUCCEEDED (terminal, happy path)
 *   PENDING → FAILED (terminal, provider rejection)
 *   SUCCEEDED → REFUND_PENDING → REFUNDED (terminal, refund flow)
 *
 * SUCCEEDED is the authoritative success state (used by payment providers).
 * COMPLETED is a legacy alias for SUCCEEDED preserved in historical records;
 *   new records must use SUCCEEDED.
 */
export type TransactionPaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'COMPLETED'   // legacy alias for SUCCEEDED — historical records only
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type PaymentMethod = 'ONLINE' | 'PAY_AT_RESTAURANT' | 'CASH' | 'MANUAL';
export type NotificationChannel = 'IN_APP' | 'SMS' | 'WHATSAPP' | 'EMAIL' | 'PUSH';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED';
export type QueueOperatingState = 'OPEN' | 'PAUSED' | 'CLOSING_SOON' | 'CLOSED';

/**
 * Outbox event processing states.
 *   PENDING    → eligible for claiming (initial state, or post-failure retry)
 *   PROCESSING → claimed by a worker; must be resolved within lease timeout
 *   COMPLETED  → successfully processed (terminal)
 *   FAILED     → permanently failed after max_retries exhausted (terminal)
 */
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type InventoryUnit = 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'packet' | 'box' | 'bottle';
export type MovementType =
  | 'INITIAL'
  | 'PURCHASE'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'WASTE'
  | 'CORRECTION'
  | 'ORDER_CONSUMPTION'
  | 'ORDER_REVERSAL';

export type StockState = 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface Database {
  public: {
    Tables: {
      restaurants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          country: string | null;
          timezone: string;
          currency: string;
          status: RestaurantStatus;
          logo_url: string | null;
          queue_enabled: boolean;
          queue_operating_state: QueueOperatingState;
          closing_soon_minutes: number;
          max_queue_capacity: number;
          min_party_size: number;
          max_party_size: number;
          call_timeout_minutes: number;
          avg_service_time_mins: number;
          service_capacity_units: number;
          eta_buffer_mins: number;
          almost_your_turn_threshold: number;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
          seating_mode: SeatingMode;
          auto_expire_called: boolean;
          /** Phase 1 Takeaway: enables Takeaway queue creation for this restaurant. Default false. */
          takeaway_enabled: boolean;
          dine_in_customer_ordering_enabled: boolean;
          dine_in_staff_ordering_enabled: boolean;
          takeaway_customer_ordering_enabled: boolean;
          takeaway_staff_ordering_enabled: boolean;
          takeaway_manual_ordering_enabled: boolean;
          /** Phase 2 Customer Theme: active customer-facing presentation theme identifier. Default 'default'. */
          customer_theme_key: string;
        };
        Insert: Omit<Database['public']['Tables']['restaurants']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          seating_mode?: SeatingMode;
          auto_expire_called?: boolean;
          takeaway_enabled?: boolean;
          dine_in_customer_ordering_enabled?: boolean;
          dine_in_staff_ordering_enabled?: boolean;
          takeaway_customer_ordering_enabled?: boolean;
          takeaway_staff_ordering_enabled?: boolean;
          takeaway_manual_ordering_enabled?: boolean;
          customer_theme_key?: string;
        };
        Update: Partial<Database['public']['Tables']['restaurants']['Insert']>;
      };
      user_profiles: {
        Row: {
          id: string;
          display_name: string;
          email: string | null;
          phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['user_profiles']['Row'], 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['user_profiles']['Insert']>;
      };
      restaurant_memberships: {
        Row: {
          id: string;
          user_id: string;
          restaurant_id: string | null;
          role: UserRoleType;
          status: MembershipStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['restaurant_memberships']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['restaurant_memberships']['Insert']>;
      };
      restaurant_zones: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          description: string | null;
          sort_order: number;
          status: ZoneStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['restaurant_zones']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['restaurant_zones']['Insert']>;
      };
      restaurant_tables: {
        Row: {
          id: string;
          restaurant_id: string;
          zone_id: string | null;
          table_number: string;
          capacity: number;
          status: TableStatus;
          shape: TableShape;
          occupied_seats: number;
          free_seats: number;
          is_archived: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['restaurant_tables']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          shape?: TableShape;
          occupied_seats?: number;
          free_seats?: number;
        };
        Update: Partial<Database['public']['Tables']['restaurant_tables']['Insert']>;
      };
      active_seating_assignments: {
        Row: {
          id: string;
          restaurant_id: string;
          queue_entry_id: string;
          table_id: string;
          guests_allocated: number;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['active_seating_assignments']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['active_seating_assignments']['Insert']>;
      };
      queue_entries: {
        Row: {
          id: string;
          restaurant_id: string;
          customer_name: string;
          customer_phone: string | null;
          party_size: number;
          queue_number: number;
          status: QueueStatus;
          token_hash: string | null;
          display_number: string | null;
          notified_at: string | null;
          called_at: string | null;
          seated_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          expired_at: string | null;
          no_show_at: string | null;
          no_show_reason: string | null;
          seated_table_id: string | null;
          call_response: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED' | null;
          call_responded_at: string | null;
          call_delay_minutes: number | null;
          /** Phase 1 Takeaway: immutable service type. DINE_IN (default) or TAKEAWAY. */
          queue_type: QueueType;
          joined_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['queue_entries']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          queue_type?: QueueType;
        };
        Update: Partial<Database['public']['Tables']['queue_entries']['Insert']>;
      };
      queue_events: {
        Row: {
          id: string;
          restaurant_id: string;
          queue_entry_id: string;
          event_type: string;
          actor_user_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['queue_events']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['queue_events']['Insert']>;
      };
      menu_categories: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          description: string | null;
          sort_order: number;
          active: boolean;
          is_archived: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['menu_categories']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['menu_categories']['Insert']>;
      };
      menu_items: {
        Row: {
          id: string;
          restaurant_id: string;
          category_id: string | null;
          name: string;
          description: string | null;
          price: number;
          currency: string;
          preparation_time_minutes: number;
          active: boolean;
          available: boolean;
          is_archived: boolean;
          archived_at: string | null;
          display_order: number;
          image_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['menu_items']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['menu_items']['Insert']>;
      };
      inventory_items: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          sku: string | null;
          unit: InventoryUnit;
          current_quantity: number;
          low_stock_threshold: number;
          is_active: boolean;
          is_archived: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['inventory_items']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['inventory_items']['Insert']>;
      };
      inventory_movements: {
        Row: {
          id: string;
          restaurant_id: string;
          inventory_item_id: string;
          movement_type: MovementType;
          quantity_delta: number;
          quantity_before: number;
          quantity_after: number;
          reference_type: string | null;
          reference_id: string | null;
          reason: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['inventory_movements']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['inventory_movements']['Insert']>;
      };
      menu_item_ingredients: {
        Row: {
          id: string;
          restaurant_id: string;
          menu_item_id: string;
          inventory_item_id: string;
          quantity_required: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['menu_item_ingredients']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['menu_item_ingredients']['Insert']>;
      };
      orders: {
        Row: {
          id: string;
          restaurant_id: string;
          queue_entry_id: string | null;
          table_id: string | null;
          order_number: string;
          status: OrderStatus;
          payment_status: PaymentStatus;
          subtotal: number;
          tax: number;
          total: number;
          idempotency_key: string | null;
          order_token: string | null;
          order_token_hash: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
      };
      order_items: {
        Row: {
          id: string;
          restaurant_id: string;
          order_id: string;
          menu_item_id: string | null;
          name_snapshot: string;
          unit_price_snapshot: number;
          quantity: number;
          total_price: number;
          special_instructions: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['order_items']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>;
      };
      order_events: {
        Row: {
          id: string;
          restaurant_id: string;
          order_id: string;
          event_type: string;
          actor_user_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['order_events']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['order_events']['Insert']>;
      };
      payments: {
        Row: {
          id: string;
          restaurant_id: string;
          order_id: string;
          amount: number;
          currency: string;
          status: TransactionPaymentStatus;
          payment_method: PaymentMethod;
          attempt_number: number;
          provider: string;
          provider_reference: string | null;
          provider_order_id: string | null;
          provider_payment_id: string | null;
          parent_payment_id: string | null;
          refunded_amount: number;
          webhook_event_id: string | null;
          idempotency_key: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['payments']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['payments']['Insert']>;
      };
      payment_events: {
        Row: {
          id: string;
          restaurant_id: string;
          payment_id: string;
          event_type: string;
          actor_type: string;
          actor_id: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['payment_events']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['payment_events']['Insert']>;
      };
      notifications: {
        Row: {
          id: string;
          restaurant_id: string;
          queue_entry_id: string | null;
          order_id: string | null;
          channel: NotificationChannel;
          notification_type: string;
          recipient: string | null;
          status: NotificationStatus;
          provider: string;
          provider_message_id: string | null;
          idempotency_key: string | null;
          message: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>;
      };
      outbox_events: {
        Row: {
          id: string;
          restaurant_id: string;
          event_type: string;
          aggregate_type: 'QUEUE' | 'ORDER' | 'PAYMENT' | 'STAFF' | 'SYSTEM';
          aggregate_id: string;
          payload: Json;
          status: OutboxStatus;
          retry_count: number;
          max_retries: number;
          last_error: string | null;
          next_attempt_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['outbox_events']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['outbox_events']['Insert']>;
      };
      audit_logs: {
        Row: {
          id: string;
          restaurant_id: string | null;
          actor_user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['audit_logs']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>;
      };
      restaurant_queue_hours: {
        Row: {
          id: string;
          restaurant_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          is_closed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['restaurant_queue_hours']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['restaurant_queue_hours']['Insert']>;
      };
    };
    Functions: {
      get_current_user_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_super_admin: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      get_user_restaurant_ids: {
        Args: { p_user_id: string };
        Returns: { restaurant_id: string }[];
      };
      has_restaurant_role: {
        Args: {
          p_user_id: string;
          p_restaurant_id: string;
          p_roles: string[];
        };
        Returns: boolean;
      };
      join_queue_atomic: {
        Args: {
          p_restaurant_id: string;
          p_customer_name: string;
          p_customer_phone: string | null;
          p_party_size: number;
          p_token_hash: string;
        };
        Returns: Database['public']['Tables']['queue_entries']['Row'];
      };
      seat_queue_entry_atomic: {
        Args: {
          p_queue_entry_id: string;
          p_table_id: string;
          p_actor_user_id?: string | null;
        };
        Returns: Json;
      };
      claim_outbox_events: {
        Args: { p_limit?: number };
        /**
         * Returns outbox events already transitioned to PROCESSING status.
         * Concurrent workers will never receive the same events.
         */
        Returns: Database['public']['Tables']['outbox_events']['Row'][];
      };
      recover_stale_outbox_events: {
        Args: { p_stale_after_mins?: number };
        /** Returns the number of stale PROCESSING events recovered. */
        Returns: number;
      };
      deduct_inventory_atomic: {
        Args: {
          p_restaurant_id: string;
          p_inventory_item_id: string;
          p_quantity: number;
          p_reference_type?: string;
          p_reference_id?: string | null;
          p_reason?: string | null;
          p_created_by?: string | null;
        };
        /**
         * Returns a JSONB result with fields:
         *   success: boolean
         *   idempotent: boolean (true if already consumed — no-op)
         *   movementId?: string
         *   itemId: string
         *   itemName: string
         *   quantityBefore: number
         *   quantityAfter: number
         *   quantityDeducted?: number
         */
        Returns: Json;
      };
      get_queue_metrics_summary: {
        Args: {
          p_restaurant_id: string;
          p_start_date: string;
          p_end_date: string;
        };
        Returns: Json;
      };
      get_hourly_queue_volume: {
        Args: {
          p_restaurant_id: string;
          p_start_date: string;
          p_end_date: string;
        };
        Returns: Json;
      };
      get_commerce_metrics_summary: {
        Args: {
          p_restaurant_id: string;
          p_start_date: string;
          p_end_date: string;
        };
        Returns: Json;
      };
      transition_queue_entry_atomic: {
        Args: { p_queue_entry_id: string; p_target_status: string; p_actor_user_id?: string | null; p_reason?: string | null };
        Returns: Database['public']['Tables']['queue_entries']['Row'];
      };
      set_queue_operating_state: {
        Args: { p_restaurant_id: string; p_new_state: string; p_actor_user_id?: string | null; p_reason?: string | null };
        Returns: Database['public']['Tables']['restaurants']['Row'];
      };
      recommend_tables_for_queue_entry: {
        Args: { p_queue_entry_id: string };
        Returns: Json;
      };
      expire_overdue_called_queue_entries: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      respond_to_call_atomic: {
        Args: {
          p_queue_entry_id: string;
          p_token_hash: string;
          p_response: string;
          p_delay_minutes?: number | null;
        };
        Returns: Json;
      };
    };
  };
}

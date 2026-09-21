import { createAdminClient } from '@/lib/db/supabase/admin';
import { QueueStatus, QueueOperatingState } from '@/types/database.types';
import { generateQueueToken, hashQueueToken } from '@/lib/utils/token-utils';
import { ETAService, RestaurantETAConfig } from '@/lib/services/eta-service';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { logger } from '@/lib/logging/logger';
import { z } from 'zod';

export type QueueHealthState = 'HEALTHY' | 'BUSY' | 'CRITICAL' | 'EMPTY' | 'CLOSED' | 'PAUSED';

export interface QueueHealth {
  activeCount: number;
  waitingCount: number;
  notifiedCount: number;
  calledCount: number;
  seatedCount: number;
  noShowCountToday: number;
  avgWaitMins: number | null;
  oldestWaitingAgeMins: number | null;
  overdueCount: number;
  availableTables: number;
  occupiedTables: number;
  cleaningTables: number;
  reservedTables: number;
  outOfServiceTables: number;
  totalTables: number;
  operatingState: QueueOperatingState;
  queueEnabled: boolean;
  isFull: boolean;
  health: QueueHealthState;
  healthReason: string;
  dineInWaitingCount?: number;
  takeawayWaitingCount?: number;
  dineInActiveCount?: number;
  takeawayActiveCount?: number;
}

export const JoinQueueSchema = z.object({
  restaurantId: z.string().uuid(),
  customerName: z.string().min(1, 'Customer name is required').max(100),
  customerPhone: z.string().optional().nullable(),
  partySize: z.number().int().min(1, 'Party size must be at least 1').max(50),
  /** Phase 1 Takeaway: service type for this queue entry. Server-validated. */
  queueType: z.enum(['DINE_IN', 'TAKEAWAY']).optional().default('DINE_IN'),
});

export type JoinQueueInput = z.input<typeof JoinQueueSchema>;

export const UpdateQueueStatusSchema = z.object({
  entryId: z.string().uuid(),
  newStatus: z.string() as z.ZodType<QueueStatus>,
  actorUserId: z.string().uuid().optional().nullable(),
  reason: z.string().optional(),
});

export type UpdateQueueStatusInput = z.infer<typeof UpdateQueueStatusSchema>;

export const QueueSettingsSchema = z.object({
  queueEnabled: z.boolean().optional(),
  maxQueueCapacity: z.number().int().min(1).max(1000).optional(),
  minPartySize: z.number().int().min(1).max(20).optional(),
  maxPartySize: z.number().int().min(1).max(50).optional(),
  callTimeoutMinutes: z.number().int().min(1).max(120).optional(),
  autoExpireCalled: z.boolean().optional(),
});

export type QueueSettingsInput = z.infer<typeof QueueSettingsSchema>;

export const ETASettingsSchema = z.object({
  avgServiceTimeMins: z.number().int().min(1).max(180),
  serviceCapacityUnits: z.number().int().min(1).max(50),
  etaBufferMins: z.number().int().min(0).max(60),
  almostYourTurnThreshold: z.number().int().min(1).max(20),
});

export type ETASettingsInput = z.infer<typeof ETASettingsSchema>;

export interface QueueLateInfo {
  isLate: boolean;
  delayMinutes?: number;
  note?: string;
  reportedAt?: string;
  tablePassedToNext?: boolean;
}

export interface QueueChatMessage {
  id: string;
  sender: 'customer' | 'staff';
  senderName: string;
  message: string;
  createdAt: string;
}

export interface PublicQueueStatusResponse {
  entryId: string;
  restaurantId: string;
  restaurantName: string;
  customerName: string;
  partySize: number;
  status: QueueStatus;
  position: number | null;
  peopleAhead: number | null;
  displayNumber: string | null;
  joinedAt: string;
  calledAt: string | null;
  seatedAt: string | null;
  tableNumber?: string | null;
  estimatedWaitMins: number | null;
  formattedETA: string;
  isAlmostYourTurn: boolean;
  lateInfo?: QueueLateInfo | null;
  chatMessages?: QueueChatMessage[];
  nowCallingNumber?: string | null;
  upNextNumber?: string | null;
  recentlySeatedNumbers?: string[];
  completedAt?: string | null;
  callResponse?: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED' | null;
  callRespondedAt?: string | null;
  callDelayMinutes?: number | null;
  callTimeoutMinutes?: number;
  /** Phase 1 Takeaway: the service type of this queue entry. */
  queueType?: 'DINE_IN' | 'TAKEAWAY';
}

export class QueueService {
  /**
   * Joins a customer party to a restaurant queue atomically.
   */
  static async joinQueue(input: JoinQueueInput) {
    const validated = JoinQueueSchema.parse(input);
    const supabase = createAdminClient();

    const rawToken = generateQueueToken();
    const tokenHash = hashQueueToken(rawToken);

    // Call atomic PostgreSQL function for capacity & duplicate concurrency protection
    // p_queue_type is validated server-side in the RPC itself — we do not trust the client value blindly.
    const { data: entry, error } = await supabase.rpc('join_queue_atomic', {
      p_restaurant_id: validated.restaurantId,
      p_customer_name: validated.customerName.trim(),
      p_customer_phone: validated.customerPhone ? validated.customerPhone.trim() : null,
      p_party_size: validated.partySize,
      p_token_hash: tokenHash,
      p_queue_type: validated.queueType ?? 'DINE_IN',
    });

    if (error) {
      if (error.message.includes('QUEUE_OUTSIDE_OPERATING_HOURS')) {
        throw new Error('QUEUE_OUTSIDE_OPERATING_HOURS');
      }
      if (error.message.includes('QUEUE_PAUSED')) {
        throw new Error('QUEUE_PAUSED');
      }
      if (error.message.includes('QUEUE_CLOSED')) {
        throw new Error('QUEUE_CLOSED');
      }
      if (error.message.includes('INVALID_PARTY_SIZE')) {
        throw new Error('INVALID_PARTY_SIZE');
      }
      if (error.message.includes('QUEUE_FULL')) {
        throw new Error('QUEUE_FULL');
      }
      if (error.message.includes('DUPLICATE_ACTIVE_ENTRY') || error.code === '23505') {
        throw new Error('DUPLICATE_ACTIVE_ENTRY');
      }
      if (error.message.includes('TAKEAWAY_DISABLED')) {
        throw new Error('TAKEAWAY_DISABLED');
      }
      if (error.message.includes('INVALID_QUEUE_TYPE')) {
        throw new Error('INVALID_QUEUE_TYPE');
      }
      throw new Error(`Queue join failed: ${error.message}`);
    }

    // Outbox for QUEUE_JOINED is now inserted atomically inside join_queue_atomic (with pg_notify), no separate publish needed

    return {
      entry,
      rawToken,
    };
  }

  /**
   * Retrieves a customer's queue status using their secure raw token.
   * Calculates dynamic position, people ahead, and explainable ETA.
   */
  static async getQueueStatusByToken(rawToken: string): Promise<PublicQueueStatusResponse | null> {
    if (!rawToken) return null;
    const tokenHash = hashQueueToken(rawToken);

    const supabase = createAdminClient();

    const { data: entry, error } = await supabase
      .from('queue_entries')
      .select('*, restaurants!inner(name, timezone, avg_service_time_mins, service_capacity_units, eta_buffer_mins, almost_your_turn_threshold, call_timeout_minutes)')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error || !entry) {
      return null;
    }

    const restaurantObj = entry.restaurants as unknown as {
      name: string;
      timezone?: string;
      avg_service_time_mins?: number;
      service_capacity_units?: number;
      eta_buffer_mins?: number;
      almost_your_turn_threshold?: number;
      call_timeout_minutes?: number;
    };

    // Cutoff calculation: only count active tickets from the current operating shift (>= 5 AM)
    const { data: cutoffData } = await supabase.rpc('get_recent_5am_cutoff', {
      p_timezone: restaurantObj?.timezone || 'UTC',
    });

    let position: number | null = null;
    let peopleAhead: number | null = null;

    if (entry.status === 'CALLED') {
      position = 1;
      peopleAhead = 0;
    } else if (['WAITING', 'NOTIFIED'].includes(entry.status)) {
      // Position counts all active (WAITING/NOTIFIED/CALLED) ahead of this entry
      // for the SAME queue_type — Dine-In and Takeaway positions are isolated.
      const entryQueueType = (entry as unknown as { queue_type?: string }).queue_type || 'DINE_IN';
      let countQuery = supabase
        .from('queue_entries')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', entry.restaurant_id)
        .eq('queue_type', entryQueueType)
        .in('status', ['WAITING', 'NOTIFIED', 'CALLED'])
        .or(`joined_at.lt.${entry.joined_at},and(joined_at.eq.${entry.joined_at},id.lt.${entry.id})`);

      if (cutoffData) {
        countQuery = countQuery.gte('joined_at', cutoffData);
      }

      const { count, error: countError } = await countQuery;

      if (!countError && count !== null) {
        position = count + 1;
        peopleAhead = count;
      }
    }

    const etaConfig: RestaurantETAConfig = {
      avgServiceTimeMins: restaurantObj?.avg_service_time_mins ?? 15,
      serviceCapacityUnits: restaurantObj?.service_capacity_units ?? 3,
      etaBufferMins: restaurantObj?.eta_buffer_mins ?? 5,
      almostYourTurnThreshold: restaurantObj?.almost_your_turn_threshold ?? 3,
    };

    const etaResult = ETAService.calculateETA(position, etaConfig);

    // Safe table number lookup for SEATED customers only (never expose internal table UUID)
    let tableNumber: string | null = null;
    if (entry.status === 'SEATED' && entry.seated_table_id) {
      const { data: tableData } = await supabase
        .from('restaurant_tables')
        .select('table_number')
        .eq('id', entry.seated_table_id)
        .maybeSingle();
      if (tableData?.table_number) {
        tableNumber = String(tableData.table_number);
      }
    }

    const isCalled = entry.status === 'CALLED';
    const isSeated = entry.status === 'SEATED';

    // Fetch any late notices, call response events, or chat messages for this ticket
    let lateInfo: QueueLateInfo | null = null;
    let eventCallResponse: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED' | null = null;
    let eventCallRespondedAt: string | null = null;
    let eventCallDelayMinutes: number | null = null;
    const chatMessages: QueueChatMessage[] = [];
    try {
      const { data: events } = await supabase
        .from('queue_events')
        .select('id, event_type, metadata, created_at')
        .eq('queue_entry_id', entry.id)
        .in('event_type', ['CUSTOMER_LATE', 'CHAT_MESSAGE', 'TABLE_PASSED_TO_NEXT', 'QUEUE_CALL_ACCEPTED', 'QUEUE_CALL_DELAY_REQUESTED'])
        .order('created_at', { ascending: true });

      if (events && events.length > 0) {
        let isLate = false;
        let delayMinutes = 10;
        let lateNote = '';
        let lateReportedAt = '';
        let tablePassed = false;

        for (const ev of events) {
          const meta = (ev.metadata || {}) as Record<string, unknown>;
          if (ev.event_type === 'CUSTOMER_LATE') {
            isLate = true;
            delayMinutes = Number(meta.delayMinutes) || 10;
            lateNote = String(meta.note || '');
            lateReportedAt = ev.created_at;
          } else if (ev.event_type === 'TABLE_PASSED_TO_NEXT') {
            isLate = true;
            tablePassed = true;
            if (!lateReportedAt) lateReportedAt = ev.created_at;
          } else if (ev.event_type === 'QUEUE_CALL_ACCEPTED') {
            eventCallResponse = 'ACCEPTED';
            eventCallRespondedAt = ev.created_at;
          } else if (ev.event_type === 'QUEUE_CALL_DELAY_REQUESTED') {
            eventCallResponse = 'DELAY_REQUESTED';
            eventCallRespondedAt = ev.created_at;
            eventCallDelayMinutes = Number(meta.delayMinutes) || 10;
          } else if (ev.event_type === 'CHAT_MESSAGE') {
            chatMessages.push({
              id: ev.id,
              sender: (meta.sender as 'customer' | 'staff') || 'customer',
              senderName: String(meta.senderName || (meta.sender === 'staff' ? 'Host Stand' : entry.customer_name)),
              message: String(meta.message || ''),
              createdAt: ev.created_at,
            });
          }
        }

        if (isLate) {
          lateInfo = {
            isLate: true,
            delayMinutes,
            note: lateNote,
            reportedAt: lateReportedAt,
            tablePassedToNext: tablePassed,
          };
        }
      }
    } catch {
      // Non-blocking degradation
    }

    let nowCallingNumber: string | null = null;
    let upNextNumber: string | null = null;
    const recentlySeatedNumbers: string[] = [];

    try {
      // 1. Who is now calling?
      if (entry.status === 'CALLED') {
        nowCallingNumber = entry.display_number;
      } else {
        let calledQuery = supabase
          .from('queue_entries')
          .select('display_number')
          .eq('restaurant_id', entry.restaurant_id)
          .eq('status', 'CALLED')
          .order('called_at', { ascending: false })
          .limit(1);
        if (cutoffData) calledQuery = calledQuery.gte('joined_at', cutoffData);
        const { data: calledRow } = await calledQuery.maybeSingle();
        nowCallingNumber = calledRow?.display_number || null;
      }

      // 2. Who is up next in line?
      let nextQuery = supabase
        .from('queue_entries')
        .select('display_number')
        .eq('restaurant_id', entry.restaurant_id)
        .in('status', ['NOTIFIED', 'WAITING'])
        .order('joined_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1);
      if (cutoffData) nextQuery = nextQuery.gte('joined_at', cutoffData);
      const { data: nextRow } = await nextQuery.maybeSingle();
      upNextNumber = nextRow?.display_number || null;

      // 3. Who went inside / recently seated?
      let seatedQuery = supabase
        .from('queue_entries')
        .select('display_number')
        .eq('restaurant_id', entry.restaurant_id)
        .eq('status', 'SEATED')
        .order('seated_at', { ascending: false })
        .limit(3);
      if (cutoffData) seatedQuery = seatedQuery.gte('joined_at', cutoffData);
      const { data: seatedRows } = await seatedQuery;
      if (seatedRows && seatedRows.length > 0) {
        for (const row of seatedRows) {
          if (row.display_number) recentlySeatedNumbers.push(row.display_number);
        }
      }
    } catch {
      // Non-blocking degradation
    }

    return {
      entryId: entry.id,
      restaurantId: entry.restaurant_id,
      restaurantName: restaurantObj?.name || 'Restaurant',
      customerName: entry.customer_name,
      partySize: entry.party_size,
      status: entry.status,
      position: isCalled || isSeated ? null : position,
      peopleAhead: isCalled || isSeated ? null : peopleAhead,
      displayNumber: entry.display_number,
      joinedAt: entry.joined_at,
      calledAt: entry.called_at || entry.notified_at,
      seatedAt: entry.seated_at,
      tableNumber,
      estimatedWaitMins: isCalled || isSeated ? null : etaResult.estimatedWaitMins,
      formattedETA: isCalled ? 'Your turn is here' : isSeated ? 'Seated' : etaResult.formattedETA,
      isAlmostYourTurn: isCalled || isSeated ? false : etaResult.isAlmostYourTurn,
      lateInfo,
      chatMessages,
      nowCallingNumber,
      upNextNumber,
      recentlySeatedNumbers,
      completedAt: entry.completed_at || null,
      callResponse: (entry as unknown as { call_response?: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED' | null }).call_response || eventCallResponse || null,
      callRespondedAt: (entry as unknown as { call_responded_at?: string | null }).call_responded_at || eventCallRespondedAt || null,
      callDelayMinutes: (entry as unknown as { call_delay_minutes?: number | null }).call_delay_minutes || eventCallDelayMinutes || null,
      callTimeoutMinutes: restaurantObj?.call_timeout_minutes ?? 15,
      queueType: ((entry as unknown as { queue_type?: 'DINE_IN' | 'TAKEAWAY' }).queue_type || 'DINE_IN') as 'DINE_IN' | 'TAKEAWAY',
    };
  }

  // Canonical FSM definition (authoritative, production-safe)
  static readonly CANONICAL_TRANSITIONS: Record<string, string[]> = {
    WAITING: ['NOTIFIED', 'CALLED', 'CANCELLED', 'EXPIRED'],
    NOTIFIED: ['CALLED', 'CANCELLED', 'EXPIRED'],
    CALLED: ['NO_SHOW', 'CANCELLED', 'EXPIRED'],
    SEATED: [], // terminal - no transitions via updateQueueStatus (only via table lifecycle)
    CANCELLED: [],
    NO_SHOW: [],
    EXPIRED: [],
    COMPLETED: [], // legacy terminal
    REMOVED: [], // legacy terminal
    SKIPPED: [], // legacy terminal
  };

  static readonly TERMINAL_STATUSES = ['SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'COMPLETED', 'REMOVED', 'SKIPPED'];
  static readonly LEGACY_STATUSES = ['COMPLETED', 'REMOVED', 'SKIPPED'];

  static isTerminalStatus(status: string): boolean {
    return (QueueService.TERMINAL_STATUSES as string[]).includes(status);
  }

  static isValidTransition(from: string, to: string): boolean {
    if (from === to) return true;
    const allowed = QueueService.CANONICAL_TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
  }

  /**
   * Centralized authoritative queue transition.
   * All queue status changes MUST flow through this method.
   * Validates FSM, handles idempotency, concurrency via conditional update, and ensures atomic side effects.
   */
  static async transitionQueue(input: UpdateQueueStatusInput & { requirePermission?: boolean; restaurantId?: string }) {
    return QueueService.updateQueueStatus(input);
  }

  /**
   * Updates queue entry status via atomic DB transaction (row lock + event + outbox + pg_notify).
   * Single authoritative transition layer - all queue status changes MUST flow here.
   */
  static async updateQueueStatus(input: UpdateQueueStatusInput) {
    const validated = UpdateQueueStatusSchema.parse(input);
    const supabase = createAdminClient();

    // Fast path: fetch current for auth and idempotency check (light)
    const { data: current, error: fetchErr } = await supabase
      .from('queue_entries')
      .select('restaurant_id, status')
      .eq('id', validated.entryId)
      .single();

    if (fetchErr || !current) {
      throw new Error('QUEUE_ENTRY_NOT_FOUND');
    }

    if (current.status === validated.newStatus) {
      // Idempotent - already in target
      const { data: full } = await supabase.from('queue_entries').select('*').eq('id', validated.entryId).single();
      return full || current;
    }

    // Authorization: staff requires permission, anon only CANCELLED
    if (validated.actorUserId) {
      let requiredPerm: string = PERMISSIONS.QUEUE_MANAGE;
      if (validated.newStatus === 'CANCELLED') requiredPerm = PERMISSIONS.QUEUE_CANCEL;
      await AuthorizationService.requirePermission({
        userId: validated.actorUserId,
        restaurantId: current.restaurant_id,
        permission: requiredPerm as unknown as typeof PERMISSIONS.QUEUE_MANAGE,
      });
    } else {
      if (validated.newStatus !== 'CANCELLED') {
        throw new Error('UNAUTHORIZED_QUEUE_ACTION: Anonymous can only cancel');
      }
    }

    // Client-side FSM pre-check (fast fail, DB will re-validate)
    if (QueueService.isTerminalStatus(current.status)) {
      throw new Error(`INVALID_QUEUE_TRANSITION: Cannot transition from terminal ${current.status} to ${validated.newStatus}`);
    }
    if (!QueueService.isValidTransition(current.status, validated.newStatus)) {
      throw new Error(`INVALID_QUEUE_TRANSITION: ${current.status} -> ${validated.newStatus} not allowed. Allowed: ${(QueueService.CANONICAL_TRANSITIONS[current.status] || []).join(', ')}`);
    }
    if (validated.newStatus === 'SEATED') {
      throw new Error('INVALID_QUEUE_TRANSITION: Use seating operation for SEATED');
    }
    if ((QueueService.LEGACY_STATUSES as string[]).includes(validated.newStatus)) {
      throw new Error(`INVALID_QUEUE_TRANSITION: ${validated.newStatus} is legacy`);
    }

    // Atomic DB transition (UPDATE + queue_events + outbox + audit + pg_notify in one transaction)
    const { data: updated, error: rpcErr } = await supabase.rpc('transition_queue_entry_atomic', {
      p_queue_entry_id: validated.entryId,
      p_target_status: validated.newStatus,
      p_actor_user_id: validated.actorUserId || null,
      p_reason: validated.reason || null,
    });

    if (rpcErr) {
      const msg = rpcErr.message || '';
      if (msg.includes('QUEUE_STATE_CONFLICT')) throw new Error('QUEUE_STATE_CONFLICT: Concurrent modification, please refresh');
      if (msg.includes('INVALID_QUEUE_TRANSITION')) throw new Error(msg);
      if (msg.includes('QUEUE_ENTRY_NOT_FOUND')) throw new Error('QUEUE_ENTRY_NOT_FOUND');
      throw new Error(msg || `Failed to update queue status: ${rpcErr.message}`);
    }

    return updated as unknown as typeof current;
  }

  /**
   * Atomically seats a queue entry at an available suitable table.
   *
   * Authorization: Requires queue.seat permission for the restaurant that owns
   * the queue entry. The authenticated user ID is derived from the session;
   * p_actor_user_id is passed through for audit logging but the DB function
   * independently verifies the permission via auth.uid().
   *
   * @throws AuthorizationError if caller lacks queue.seat permission
   * @throws Error with descriptive code if FSM state is invalid
   */
  static async seatQueueEntry(
    entryId: string,
    tableId: string,
    actorUserId?: string,
    actualGuests?: number,
    additionalTableIds?: string[]
  ) {
    const supabase = createAdminClient();

    // Step 1: Fetch entry to get restaurant_id for permission check
    const { data: entry, error: fetchErr } = await supabase
      .from('queue_entries')
      .select('restaurant_id, party_size, status, queue_type')
      .eq('id', entryId)
      .single();

    if (fetchErr || !entry) {
      throw new Error('QUEUE_ENTRY_NOT_FOUND');
    }

    if ((entry as unknown as { queue_type?: string }).queue_type === 'TAKEAWAY') {
      throw new Error('TAKEAWAY_CANNOT_BE_SEATED: Takeaway orders do not receive table assignments. Use complete_takeaway_atomic instead.');
    }

    // Step 2: Enforce authorization — must have queue.seat permission
    const authContext = await AuthorizationService.requirePermission({
      userId: actorUserId,
      restaurantId: entry.restaurant_id,
      permission: PERMISSIONS.QUEUE_SEAT,
    });

    const seatingCount =
      Number.isInteger(actualGuests) && (actualGuests as number) > 0
        ? (actualGuests as number)
        : (entry as unknown as { party_size?: number }).party_size ?? 1;

    // Call atomic PostgreSQL function supporting single, multi-table combination, and shared capacity seating
    const { data, error } = await supabase.rpc('seat_queue_entry_atomic', {
      p_queue_entry_id: entryId,
      p_table_id: tableId,
      p_actor_user_id: authContext.userId,
      p_actual_guests: seatingCount,
      p_additional_table_ids: additionalTableIds && additionalTableIds.length > 0 ? additionalTableIds : null,
    });

    if (error) {
      if (error.message.includes('QUEUE_ENTRY_TERMINAL')) {
        throw new Error('QUEUE_ENTRY_TERMINAL: Cannot seat a queue entry in a terminal state');
      }
      if (error.message.includes('TAKEAWAY_CANNOT_BE_SEATED')) {
        throw new Error('TAKEAWAY_CANNOT_BE_SEATED: Takeaway orders do not receive table assignments. Use complete_takeaway_atomic instead.');
      }
      // Phase 3E: surface FSM rejections verbatim before the SEATED-substring
      // fallback below (which would otherwise mislabel them as ALREADY_SEATED).
      if (error.message.includes('INVALID_QUEUE_TRANSITION')) {
        throw new Error(error.message);
      }
      if (error.message.includes('QUEUE_ENTRY_ALREADY_SEATED') || error.message.includes('SEATED')) {
        throw new Error('QUEUE_ENTRY_ALREADY_SEATED');
      }
      if (error.message.includes('QUEUE_ENTRY_NOT_SEATABLE')) {
        throw new Error('QUEUE_ENTRY_NOT_SEATABLE');
      }
      if (error.message.includes('TABLE_NOT_AVAILABLE')) {
        throw new Error('TABLE_NOT_AVAILABLE');
      }
      if (error.message.includes('INSUFFICIENT_TABLE_CAPACITY')) {
        throw new Error('INSUFFICIENT_TABLE_CAPACITY');
      }
      if (error.message.includes('TENANT_MISMATCH')) {
        throw new Error('TENANT_MISMATCH');
      }
      if (error.message.includes('UNAUTHORIZED')) {
        throw new Error('UNAUTHORIZED: Insufficient permissions to seat queue entry');
      }
      if (error.message.includes('TABLE_ARCHIVED')) {
        throw new Error('TABLE_ARCHIVED: Cannot seat at an archived table');
      }
      throw new Error(`Seating failed: ${error.message}`);
    }

    return data;
  }

  /**
   * Fetches available tables suitable for seating a party size.
   */
  static async getSeatableTables(restaurantId: string, partySize: number) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('restaurant_tables')
      .select('*, restaurant_zones(name)')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'AVAILABLE')
      .eq('is_archived', false)
      .gte('capacity', partySize)
      .order('capacity', { ascending: true })
      .order('table_number', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch seatable tables: ${error.message}`);
    }

    return data;
  }

  /**
   * Returns active queue entries for a restaurant with real-time positions.
   * Filters out entries from before the daily 5 AM reset boundary.
   *
   * @param queueType - Optional service type filter. When provided, only returns
   *   entries of that type, ensuring Dine-In and Takeaway positions are isolated.
   *   The existing dashboard calls omit this to receive DINE_IN entries only
   *   (default behaviour preserved for backward compatibility).
   */
  static async getActiveQueue(restaurantId: string, queueType?: 'DINE_IN' | 'TAKEAWAY') {
    const supabase = createAdminClient();

    // Get timezone
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();

    const { data: cutoffData, error: cutoffError } = await supabase.rpc('get_recent_5am_cutoff', {
      p_timezone: restaurant?.timezone || 'UTC'
    });

    let query = supabase
      .from('queue_entries')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .in('status', ['WAITING', 'NOTIFIED', 'CALLED'])
      .order('joined_at', { ascending: true })
      .order('id', { ascending: true });

    // Phase 1 Takeaway: isolate queue positions by service type.
    // When queueType is provided, filter to only that type.
    // Defaults to DINE_IN when not specified (preserving existing dashboard behavior).
    query = query.eq('queue_type', queueType ?? 'DINE_IN');

    if (!cutoffError && cutoffData) {
      query = query.gte('joined_at', cutoffData);
    }

    const { data: entries, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch active queue: ${error.message}`);
    }

    // Priority definition:
    // 0: CALLED (ACCEPTED) - Guest confirmed on the way, ready to seat
    // 1: CALLED (AWAITING) - Waiting for guest response
    // 2: NOTIFIED
    // 3: WAITING
    // 4: CALLED (DELAY_REQUESTED) - Guest requested more time, goes below waiting guests
    const priority: Record<string, number> = { CALLED: 1, NOTIFIED: 2, WAITING: 3 };
    entries.sort((a, b) => {
      const isDelayedA = (a as unknown as { call_response?: string }).call_response === 'DELAY_REQUESTED';
      const isDelayedB = (b as unknown as { call_response?: string }).call_response === 'DELAY_REQUESTED';
      const isAcceptedA = a.status === 'CALLED' && (a as unknown as { call_response?: string }).call_response === 'ACCEPTED';
      const isAcceptedB = b.status === 'CALLED' && (b as unknown as { call_response?: string }).call_response === 'ACCEPTED';

      const pa = isDelayedA ? 4 : isAcceptedA ? 0 : (priority[a.status] ?? 9);
      const pb = isDelayedB ? 4 : isAcceptedB ? 0 : (priority[b.status] ?? 9);

      if (pa !== pb) return pa - pb;
      return new Date(a.joined_at || a.created_at).getTime() - new Date(b.joined_at || b.created_at).getTime();
    });

    const entryIds = entries.map((e) => e.id);
    const lateMap = new Map<string, QueueLateInfo>();
    const chatMap = new Map<string, QueueChatMessage[]>();
    const callResponseMap = new Map<string, { response: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED'; delayMinutes?: number; respondedAt?: string }>();

    if (entryIds.length > 0) {
      try {
        const { data: events } = await supabase
          .from('queue_events')
          .select('id, queue_entry_id, event_type, metadata, created_at')
          .in('queue_entry_id', entryIds)
          .in('event_type', ['CUSTOMER_LATE', 'CHAT_MESSAGE', 'TABLE_PASSED_TO_NEXT', 'QUEUE_CALL_ACCEPTED', 'QUEUE_CALL_DELAY_REQUESTED'])
          .order('created_at', { ascending: true });

        if (events) {
          for (const ev of events) {
            const meta = (ev.metadata || {}) as Record<string, unknown>;
            if (ev.event_type === 'CUSTOMER_LATE') {
              lateMap.set(ev.queue_entry_id, {
                isLate: true,
                delayMinutes: Number(meta.delayMinutes) || 10,
                note: String(meta.note || ''),
                reportedAt: ev.created_at,
                tablePassedToNext: lateMap.get(ev.queue_entry_id)?.tablePassedToNext || false,
              });
            } else if (ev.event_type === 'TABLE_PASSED_TO_NEXT') {
              const existing = lateMap.get(ev.queue_entry_id);
              if (existing) {
                existing.tablePassedToNext = true;
              } else {
                lateMap.set(ev.queue_entry_id, {
                  isLate: true,
                  tablePassedToNext: true,
                  reportedAt: ev.created_at,
                });
              }
            } else if (ev.event_type === 'QUEUE_CALL_ACCEPTED') {
              callResponseMap.set(ev.queue_entry_id, {
                response: 'ACCEPTED',
                respondedAt: ev.created_at,
              });
            } else if (ev.event_type === 'QUEUE_CALL_DELAY_REQUESTED') {
              callResponseMap.set(ev.queue_entry_id, {
                response: 'DELAY_REQUESTED',
                delayMinutes: Number(meta.delayMinutes) || 10,
                respondedAt: ev.created_at,
              });
            } else if (ev.event_type === 'CHAT_MESSAGE') {
              const list = chatMap.get(ev.queue_entry_id) || [];
              list.push({
                id: ev.id,
                sender: (meta.sender as 'customer' | 'staff') || 'customer',
                senderName: String(meta.senderName || 'Customer'),
                message: String(meta.message || ''),
                createdAt: ev.created_at,
              });
              chatMap.set(ev.queue_entry_id, list);
            }
          }
        }
      } catch {
        // Non-blocking
      }
    }

    // Merge entries with database columns and event fallbacks
    const enriched = entries.map((entry) => {
      const eventCall = callResponseMap.get(entry.id);
      const rowCall = (entry as unknown as { call_response?: string | null }).call_response;
      const rowRespondedAt = (entry as unknown as { call_responded_at?: string | null }).call_responded_at;
      const rowDelayMins = (entry as unknown as { call_delay_minutes?: number | null }).call_delay_minutes;

      const callResponse = rowCall || eventCall?.response || null;
      const callRespondedAt = rowRespondedAt || eventCall?.respondedAt || null;
      const callDelayMinutes = rowDelayMins ?? eventCall?.delayMinutes ?? null;

      return {
        ...entry,
        call_response: callResponse,
        call_responded_at: callRespondedAt,
        call_delay_minutes: callDelayMinutes,
        lateInfo: lateMap.get(entry.id) || null,
        chatMessages: chatMap.get(entry.id) || [],
      };
    });

    // Authoritative sort:
    // 0: CALLED (ACCEPTED) - Confirmed on the way, top priority
    // 1: CALLED (AWAITING) - Waiting for guest response
    // 2: NOTIFIED
    // 3: WAITING
    // 4: DELAY_REQUESTED / LATE - Moved below waiting guests
    enriched.sort((a, b) => {
      const isDelayedA = a.call_response === 'DELAY_REQUESTED' || a.lateInfo?.isLate;
      const isDelayedB = b.call_response === 'DELAY_REQUESTED' || b.lateInfo?.isLate;
      const isAcceptedA = a.status === 'CALLED' && a.call_response === 'ACCEPTED';
      const isAcceptedB = b.status === 'CALLED' && b.call_response === 'ACCEPTED';

      const pa = isDelayedA ? 4 : isAcceptedA ? 0 : (priority[a.status] ?? 9);
      const pb = isDelayedB ? 4 : isAcceptedB ? 0 : (priority[b.status] ?? 9);

      if (pa !== pb) return pa - pb;
      return new Date(a.joined_at || a.created_at).getTime() - new Date(b.joined_at || b.created_at).getTime();
    });

    let activeCount = 0;
    const formatted = enriched.map((entry) => {
      let position: number | null = null;
      let peopleAhead: number | null = null;

      if (['WAITING', 'NOTIFIED', 'CALLED'].includes(entry.status)) {
        activeCount += 1;
        position = activeCount;
        peopleAhead = activeCount - 1;
      }

      return {
        ...entry,
        position,
        peopleAhead,
      };
    });

    return formatted;
  }

  /**
   * Retrieves actively seated queue entries for a restaurant floor blueprint.
   * Only returns guests currently seated at tables whose dining is not yet completed.
   */
  static async getSeatedQueueEntries(restaurantId: string) {
    const supabase = createAdminClient();

    // Query active_seating_assignments joined with queue_entries so multi-table and shared table seatings are accurate
    const { data: assignments, error: assignError } = await supabase
      .from('active_seating_assignments')
      .select(`
        table_id,
        guests_allocated,
        is_primary,
        queue_entries (
          id,
          customer_name,
          customer_phone,
          party_size,
          actual_guests,
          queue_number,
          display_number,
          status,
          seated_table_id,
          seated_at,
          completed_at,
          joined_at
        )
      `)
      .eq('restaurant_id', restaurantId);

    // Also fetch raw queue_entries for fallback / legacy entries
    const { data: entries, error: entriesError } = await supabase
      .from('queue_entries')
      .select('id, customer_name, customer_phone, party_size, actual_guests, queue_number, display_number, status, seated_table_id, seated_at, completed_at, joined_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'SEATED')
      .is('completed_at', null)
      .order('seated_at', { ascending: false });

    if (assignError && entriesError) {
      logger.warn('Failed to fetch seated queue entries', {
        operation: 'getSeatedQueueEntries',
        metadata: { error: assignError?.message || entriesError?.message, restaurantId },
      });
      return [];
    }

    interface SeatedEntryItem {
      id: string;
      customer_name: string;
      customer_phone?: string;
      party_size: number;
      actual_guests?: number;
      queue_number?: number;
      display_number?: string | number;
      status: string;
      seated_table_id: string;
      seated_at?: string;
      completed_at?: string | null;
      joined_at?: string;
      is_primary_table?: boolean;
    }

    const results: SeatedEntryItem[] = [];
    const seenAssignments = new Set<string>();

    if (assignments && assignments.length > 0) {
      for (const a of assignments) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qe = a.queue_entries as any;
        if (!qe || qe.status !== 'SEATED' || qe.completed_at !== null) continue;
        const key = `${qe.id}_${a.table_id}`;
        seenAssignments.add(key);
        results.push({
          ...qe,
          seated_table_id: a.table_id,
          actual_guests: a.guests_allocated || qe.actual_guests || qe.party_size,
          is_primary_table: a.is_primary,
        });
      }
    }

    if (entries) {
      for (const e of entries) {
        if (!e.seated_table_id) continue;
        const key = `${e.id}_${e.seated_table_id}`;
        if (!seenAssignments.has(key)) {
          results.push(e);
        }
      }
    }

    return results;
  }

  /**
   * Exits a seated dining customer from the active flow.
   * Marks completed_at on queue_entries, logs QUEUE_COMPLETED,
   * and if the table is still OCCUPIED, transitions it to CLEANING so staff can bus it.
   */
  static async exitSeatedCustomer(entryId: string, actorUserId?: string) {
    const supabase = createAdminClient();

    const { data: entry, error: fetchError } = await supabase
      .from('queue_entries')
      .select('id, restaurant_id, seated_table_id, status, completed_at')
      .eq('id', entryId)
      .single();

    if (fetchError || !entry) {
      throw new Error('QUEUE_ENTRY_NOT_FOUND');
    }

    const nowIso = new Date().toISOString();

    // Update completed_at
    const { error: updateError } = await supabase
      .from('queue_entries')
      .update({
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', entryId);

    if (updateError) {
      throw new Error(`Failed to exit queue flow: ${updateError.message}`);
    }

    // Release active table assignments and recalculate occupancy for all tables this customer was seated at
    const { data: assignments } = await supabase
      .from('active_seating_assignments')
      .select('table_id, guests_allocated')
      .eq('queue_entry_id', entryId);

    const releasedTableIds = new Set<string>();
    if (assignments && assignments.length > 0) {
      for (const assign of assignments) {
        releasedTableIds.add(assign.table_id);
      }
      // Remove assignments
      await supabase
        .from('active_seating_assignments')
        .delete()
        .eq('queue_entry_id', entryId);
    } else if (entry.seated_table_id) {
      releasedTableIds.add(entry.seated_table_id);
    }

    // For each affected table, update occupancy and status
    for (const tid of Array.from(releasedTableIds)) {
      const { data: table } = await supabase
        .from('restaurant_tables')
        .select('id, capacity, status')
        .eq('id', tid)
        .maybeSingle();

      if (table) {
        // Count remaining active assignments on this table
        const { data: remaining } = await supabase
          .from('active_seating_assignments')
          .select('guests_allocated')
          .eq('table_id', tid);

        const totalRemaining = (remaining || []).reduce((sum, r) => sum + (r.guests_allocated || 0), 0);

        if (totalRemaining === 0) {
          // No guests left at this table -> transition to CLEANING
          await supabase
            .from('restaurant_tables')
            .update({
              status: table.status === 'OCCUPIED' ? 'CLEANING' : table.status,
              occupied_seats: 0,
              free_seats: table.capacity,
              updated_at: nowIso,
            })
            .eq('id', tid);
        } else {
          // Table still has shared guests -> update occupied & free counts
          await supabase
            .from('restaurant_tables')
            .update({
              occupied_seats: totalRemaining,
              free_seats: Math.max(0, table.capacity - totalRemaining),
              updated_at: nowIso,
            })
            .eq('id', tid);
        }
      }
    }

    // Insert queue event
    await supabase.from('queue_events').insert({
      restaurant_id: entry.restaurant_id,
      queue_entry_id: entryId,
      event_type: 'QUEUE_COMPLETED',
      actor_user_id: actorUserId || null,
      metadata: {
        reason: 'CUSTOMER_OR_STAFF_EXIT',
        seated_table_id: entry.seated_table_id,
        released_table_ids: Array.from(releasedTableIds),
        completed_at: nowIso,
      },
    });

    return { success: true, completedAt: nowIso };
  }

  /**
   * Phase 1 Takeaway: marks a Takeaway order as collected by the customer.
   * Transitions WAITING/CALLED/NOTIFIED → COMPLETED via the authoritative
   * complete_takeaway_atomic RPC. Only works on TAKEAWAY entries; DINE_IN
   * entries must go through the seating flow.
   *
   * @param entryId - UUID of the takeaway queue entry
   * @param actorUserId - UUID of the staff member marking the order collected
   */
  static async completeTakeaway(entryId: string, actorUserId: string) {
    const supabase = createAdminClient();

    // Step 1: Verify entry exists and is TAKEAWAY before RPC call
    const { data: entry, error: fetchErr } = await supabase
      .from('queue_entries')
      .select('restaurant_id, status, queue_type')
      .eq('id', entryId)
      .single();

    if (fetchErr || !entry) {
      throw new Error('QUEUE_ENTRY_NOT_FOUND');
    }

    const entryQueueType = (entry as unknown as { queue_type?: string }).queue_type;
    if (entryQueueType !== 'TAKEAWAY') {
      throw new Error('NOT_TAKEAWAY_ENTRY: This operation is only valid for Takeaway queue entries');
    }

    // Step 2: Authorize — requires takeaway.complete permission
    await AuthorizationService.requirePermission({
      userId: actorUserId,
      restaurantId: entry.restaurant_id,
      permission: PERMISSIONS.TAKEAWAY_COMPLETE,
    });

    // Rule 1 Check: If linked order exists and is PREPARING, reject until READY
    const { data: linkedOrder } = await supabase
      .from('orders')
      .select('id, status')
      .eq('queue_entry_id', entryId)
      .not('status', 'in', '("CANCELLED","SERVED")')
      .maybeSingle();

    if (linkedOrder && linkedOrder.status === 'PREPARING') {
      throw new Error('CANNOT_RECEIVE_WHILE_PREPARING: Order is currently being prepared. It must be marked READY before items can be received.');
    }

    // Step 3: Atomic RPC — all state transitions happen inside the DB
    const { data, error } = await supabase.rpc('complete_takeaway_atomic', {
      p_queue_entry_id: entryId,
      p_actor_user_id: actorUserId,
    });

    if (error) {
      if (error.message.includes('QUEUE_ENTRY_NOT_FOUND')) throw new Error('QUEUE_ENTRY_NOT_FOUND');
      if (error.message.includes('NOT_TAKEAWAY_ENTRY')) throw new Error('NOT_TAKEAWAY_ENTRY');
      if (error.message.includes('TAKEAWAY_ENTRY_NOT_COMPLETABLE')) throw new Error('TAKEAWAY_ENTRY_NOT_COMPLETABLE');
      if (error.message.includes('CANNOT_RECEIVE_WHILE_PREPARING')) throw new Error(error.message);
      throw new Error(`Failed to complete takeaway: ${error.message}`);
    }

    // Also ensure linked order transitions to SERVED
    if (linkedOrder && linkedOrder.status !== 'SERVED') {
      try {
        await supabase
          .from('orders')
          .update({ status: 'SERVED', updated_at: new Date().toISOString() })
          .eq('id', linkedOrder.id);
      } catch (orderUpdateErr) {
        logger.warn('Failed to update linked order to SERVED on completeTakeaway', { error: String(orderUpdateErr) });
      }
    }

    return data as unknown as {
      success: boolean;
      queueEntryId: string;
      displayNumber: string | null;
      status: string;
      completedAt: string;
    };
  }

  /**
   * Returns queue entries filtered by status and optional search term.
   */
  static async getAllQueueEntries(restaurantId: string, filterStatus?: string, search?: string) {
    const supabase = createAdminClient();

    let query = supabase
      .from('queue_entries')
      .select('*')
      .eq('restaurant_id', restaurantId);

    if (filterStatus && filterStatus !== 'ALL') {
      if (filterStatus === 'ACTIVE' || filterStatus === 'WAITING' || filterStatus === 'CALLED' || filterStatus === 'NOTIFIED') {
        if (filterStatus === 'ACTIVE') {
          query = query.in('status', ['WAITING', 'NOTIFIED', 'CALLED']);
        } else {
          query = query.eq('status', filterStatus);
        }
        
        // Filter out active entries from previous days (before 5 AM cutoff)
        const { data: restaurant } = await supabase
          .from('restaurants')
          .select('timezone')
          .eq('id', restaurantId)
          .single();

        const { data: cutoffData, error: cutoffError } = await supabase.rpc('get_recent_5am_cutoff', {
          p_timezone: restaurant?.timezone || 'UTC'
        });
        
        if (!cutoffError && cutoffData) {
          query = query.gte('joined_at', cutoffData);
        }
      } else if (filterStatus === 'TERMINAL') {
        query = query.in('status', ['CANCELLED', 'NO_SHOW', 'EXPIRED', 'COMPLETED', 'SEATED']);
      } else {
        query = query.eq('status', filterStatus);
      }
    }

    if (search && search.trim() !== '') {
      const q = `%${search.trim()}%`;
      query = query.or(`customer_name.ilike.${q},display_number.ilike.${q},customer_phone.ilike.${q}`);
    }

    const isActiveQuery = !filterStatus || filterStatus === 'ACTIVE' || filterStatus === 'WAITING' || filterStatus === 'CALLED' || filterStatus === 'NOTIFIED';
    
    if (isActiveQuery) {
      query = query.order('joined_at', { ascending: true }).order('id', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data: entries, error } = await query.limit(200);

    if (error) {
      throw new Error(`Failed to list queue entries: ${error.message}`);
    }

    if (isActiveQuery) {
      const priority: Record<string, number> = { CALLED: 0, NOTIFIED: 1, WAITING: 2 };
      entries.sort((a, b) => {
        const pa = priority[a.status] ?? 9;
        const pb = priority[b.status] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(a.joined_at || a.created_at).getTime() - new Date(b.joined_at || b.created_at).getTime();
      });
    } else {
      entries.sort((a, b) => new Date(b.created_at || b.joined_at).getTime() - new Date(a.created_at || a.joined_at).getTime());
    }

    return entries;
  }

  /**
   * Fetches full timeline history of queue events for a specific queue entry.
   */
  static async getQueueEntryEvents(entryId: string) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('queue_events')
      .select('*')
      .eq('queue_entry_id', entryId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch queue events: ${error.message}`);
    }

    return data;
  }

  /**
   * Opens or closes the restaurant queue.
   */
  static async toggleQueueOpen(restaurantId: string, open: boolean, actorUserId: string) {
    const supabase = createAdminClient();

    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .update({
        queue_enabled: open,
        updated_at: new Date().toISOString(),
      })
      .eq('id', restaurantId)
      .select('id, name, queue_enabled')
      .single();

    if (error) {
      throw new Error(`Failed to toggle queue state: ${error.message}`);
    }

    await supabase.from('audit_logs').insert({
      restaurant_id: restaurantId,
      actor_user_id: actorUserId,
      action: open ? 'queue_opened' : 'queue_closed',
      entity_type: 'restaurant',
      entity_id: restaurantId,
      metadata: {
        queueEnabled: open,
      },
    });

    return restaurant;
  }

  /**
   * Updates restaurant queue operating settings.
   */
  static async updateQueueSettings(restaurantId: string, settings: QueueSettingsInput, actorUserId: string) {
    const validated = QueueSettingsSchema.parse(settings);
    const supabase = createAdminClient();

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (validated.queueEnabled !== undefined) payload.queue_enabled = validated.queueEnabled;
    if (validated.maxQueueCapacity !== undefined) payload.max_queue_capacity = validated.maxQueueCapacity;
    if (validated.minPartySize !== undefined) payload.min_party_size = validated.minPartySize;
    if (validated.maxPartySize !== undefined) payload.max_party_size = validated.maxPartySize;
    if (validated.callTimeoutMinutes !== undefined) payload.call_timeout_minutes = validated.callTimeoutMinutes;
    if (validated.autoExpireCalled !== undefined) payload.auto_expire_called = validated.autoExpireCalled;

    const { data: updated, error } = await supabase
      .from('restaurants')
      .update(payload)
      .eq('id', restaurantId)
      .select('id, queue_enabled, max_queue_capacity, min_party_size, max_party_size, call_timeout_minutes, auto_expire_called')
      .single();

    if (error) {
      throw new Error(`Failed to update queue settings: ${error.message}`);
    }

    await supabase.from('audit_logs').insert({
      restaurant_id: restaurantId,
      actor_user_id: actorUserId,
      action: 'queue_settings_updated',
      entity_type: 'restaurant',
      entity_id: restaurantId,
      metadata: payload,
    });

    return updated;
  }

  /**
   * Updates restaurant ETA settings.
   */
  static async updateETASettings(restaurantId: string, settings: ETASettingsInput, actorUserId: string) {
    const validated = ETASettingsSchema.parse(settings);
    const supabase = createAdminClient();

    const { data: updated, error } = await supabase
      .from('restaurants')
      .update({
        avg_service_time_mins: validated.avgServiceTimeMins,
        service_capacity_units: validated.serviceCapacityUnits,
        eta_buffer_mins: validated.etaBufferMins,
        almost_your_turn_threshold: validated.almostYourTurnThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq('id', restaurantId)
      .select('id, avg_service_time_mins, service_capacity_units, eta_buffer_mins, almost_your_turn_threshold')
      .single();

    if (error) {
      throw new Error(`Failed to update ETA settings: ${error.message}`);
    }

    await supabase.from('audit_logs').insert({
      restaurant_id: restaurantId,
      actor_user_id: actorUserId,
      action: 'eta_settings_updated',
      entity_type: 'restaurant',
      entity_id: restaurantId,
      metadata: validated,
    });

    return updated;
  }

  /**
   * Get current queue operating state for restaurant (for public display)
   */
  static async getQueueOperatingState(restaurantId: string): Promise<{ operatingState: QueueOperatingState; queueEnabled: boolean; isFull: boolean }> {
    const supabase = createAdminClient();
    const { data: restaurant, error } = await supabase.from('restaurants').select('queue_enabled, queue_operating_state, max_queue_capacity').eq('id', restaurantId).single();
    if (error || !restaurant) throw new Error('Restaurant not found');
    const operatingState = (restaurant as unknown as { queue_operating_state: QueueOperatingState }).queue_operating_state || 'OPEN';
    const queueEnabled = restaurant.queue_enabled;
    const { count } = await supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).in('status', ['WAITING','NOTIFIED','CALLED']);
    const isFull = (count || 0) >= restaurant.max_queue_capacity;
    return { operatingState, queueEnabled, isFull };
  }

  /**
   * Set queue operating state (OPEN/PAUSED/CLOSING_SOON/CLOSED) — authoritative, idempotent, audited
   */
  static async setQueueOperatingState(restaurantId: string, newState: QueueOperatingState, actorUserId: string, reason?: string) {
    const supabase = createAdminClient();
    await AuthorizationService.requirePermission({ userId: actorUserId, restaurantId, permission: PERMISSIONS.QUEUE_MANAGE });
    const { data, error } = await supabase.rpc('set_queue_operating_state', {
      p_restaurant_id: restaurantId,
      p_new_state: newState,
      p_actor_user_id: actorUserId,
      p_reason: reason || null,
    });
    if (error) {
      if (error.message.includes('QUEUE_STATE_CONFLICT')) throw new Error('QUEUE_STATE_CONFLICT');
      if (error.message.includes('INVALID_OPERATING_STATE')) throw new Error('INVALID_OPERATING_STATE');
      throw new Error(`Failed to set queue operating state: ${error.message}`);
    }
    // Invalidate public cache so QR page reflects new state quickly
    try {
      const { CacheService, CacheKeys } = await import('@/lib/cache');
      // Find slug for cache invalidation
      const { data: rest } = await supabase.from('restaurants').select('slug').eq('id', restaurantId).single();
      if (rest) await CacheService.invalidate(CacheKeys.publicRestaurant(rest.slug));
    } catch {}
    return data;
  }

  /**
   * Expire overdue CALLED entries to NO_SHOW (server-authoritative, batch, idempotent)
   */
  static async expireOverdueCalledEntries(limit = 50): Promise<{ expiredCount: number; expiredIds: string[] }> {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('expire_overdue_called_queue_entries', { p_limit: limit });
    if (error) throw new Error(`Failed to expire overdue: ${error.message}`);
    const row = Array.isArray(data) ? (data[0] as unknown as { expired_count: number; expired_ids: string[] }) : (data as unknown as { expired_count: number; expired_ids: string[] });
    return { expiredCount: row?.expired_count || 0, expiredIds: row?.expired_ids || [] };
  }

  /**
   * Recommend tables for a queue entry (supports both single tables and combined table pairs)
   */
  /**
   * Recommend tables for a queue entry supporting SIMPLE and STRICT seating modes.
   * - SIMPLE: Exclusively available single tables first, then available table pairs if no single fits.
   * - STRICT: Evaluates available tables + partially occupied tables with free capacity.
   */
  static async recommendTablesForQueueEntry(queueEntryId: string, actorUserId?: string) {
    const supabase = createAdminClient();
    // Validate queue entry is seatable and get restaurant
    const { data: entry, error: fetchErr } = await supabase
      .from('queue_entries')
      .select('restaurant_id, party_size, status, restaurants(seating_mode)')
      .eq('id', queueEntryId)
      .single();

    if (fetchErr || !entry) throw new Error('QUEUE_ENTRY_NOT_FOUND');
    if (!['WAITING', 'NOTIFIED', 'CALLED'].includes(entry.status)) throw new Error('QUEUE_ENTRY_NOT_SEATABLE');
    // Phase 1 Takeaway: table recommendation is only valid for DINE_IN entries
    const entryQueueType = (entry as unknown as { queue_type?: string }).queue_type || 'DINE_IN';
    if (entryQueueType === 'TAKEAWAY') {
      throw new Error('TAKEAWAY_NO_TABLE_RECOMMENDATION: Takeaway entries do not receive table assignments or recommendations');
    }
    
    // Permission check if actor provided
    if (actorUserId) {
      await AuthorizationService.requirePermission({
        userId: actorUserId,
        restaurantId: entry.restaurant_id,
        permission: PERMISSIONS.QUEUE_VIEW,
      });
    }

    const restaurantObj = entry.restaurants as unknown as { seating_mode?: 'SIMPLE' | 'STRICT' } | null;
    const seatingMode: 'SIMPLE' | 'STRICT' = restaurantObj?.seating_mode || 'SIMPLE';
    const partySize = entry.party_size || 1;

    // Fetch all active tables with zone information
    const { data: tablesData } = await supabase
      .from('restaurant_tables')
      .select('id, table_number, capacity, status, shape, occupied_seats, free_seats, zone_id, restaurant_zones(name)')
      .eq('restaurant_id', entry.restaurant_id)
      .eq('is_archived', false)
      .order('capacity', { ascending: true })
      .order('table_number', { ascending: true });

    const allTables = tablesData || [];
    const extractZoneName = (rz: unknown): string => {
      if (!rz) return '';
      if (Array.isArray(rz) && rz.length > 0) return String((rz[0] as { name?: unknown }).name || '');
      if (typeof rz === 'object' && rz !== null && 'name' in rz) return String((rz as { name?: unknown }).name || '');
      return '';
    };

    interface RecommendationItem {
      table_id: string;
      table_number: string;
      capacity: number;
      zone_name: string | null;
      rank: number;
      reason: string;
      is_combination?: boolean;
      is_shared?: boolean;
      table_ids?: string[];
      combination_labels?: string[];
    }

    const recommendations: RecommendationItem[] = [];

    // 1. Single Table Exact & Optimal Fits (Available tables with capacity >= partySize)
    const availableTables = allTables.filter((t) => t.status === 'AVAILABLE');

    const singleFits = availableTables
      .filter((t) => t.capacity >= partySize)
      .map((t) => {
        const waste = t.capacity - partySize;
        const isExact = waste === 0;
        return {
          table_id: t.id,
          table_number: t.table_number,
          capacity: t.capacity,
          zone_name: extractZoneName(t.restaurant_zones) || 'Floor',
          rank: isExact ? 1 : 2 + waste,
          reason: isExact
            ? `Exact fit for party of ${partySize} (${t.capacity} seats)`
            : `Seats ${t.capacity} • Fits party of ${partySize} (${waste} spare ${waste === 1 ? 'seat' : 'seats'})`,
          is_combination: false,
          is_shared: false,
          table_ids: [t.id],
          combination_labels: [t.table_number],
        };
      })
      .sort((a, b) => a.rank - b.rank);

    recommendations.push(...singleFits);

    // 2. Strict Seating Mode: Shared Capacity Recommendations (Partially occupied tables with free_seats >= partySize)
    if (seatingMode === 'STRICT') {
      const sharedFits = allTables
        .filter((t) => t.status === 'OCCUPIED' && (t.free_seats ?? 0) >= partySize)
        .map((t) => {
          const free = t.free_seats ?? 0;
          const waste = free - partySize;
          return {
            table_id: t.id,
            table_number: t.table_number,
            capacity: t.capacity,
            zone_name: extractZoneName(t.restaurant_zones) || 'Floor',
            rank: 10 + waste,
            reason: `Shared Table ${t.table_number}: ${free} free seats available (${t.occupied_seats ?? 0} currently seated)`,
            is_combination: false,
            is_shared: true,
            table_ids: [t.id],
            combination_labels: [t.table_number],
          };
        })
        .sort((a, b) => a.rank - b.rank);

      recommendations.push(...sharedFits);
    }

    // 3. Multi-table combinations:
    // INTELLIGENT RULE:
    // If ANY single available table or (in STRICT mode) shared table fits the party headcount,
    // NEVER suggest combining multiple tables! Combining tables takes multiple tables out of
    // service and wastes floor capacity.
    const hasAnySingleOrSharedFit = singleFits.length > 0 || recommendations.some((r) => r.is_shared);
    if (partySize >= 3 && !hasAnySingleOrSharedFit && availableTables.length >= 2) {
      interface PairCandidate {
        t1: typeof availableTables[0];
        t2: typeof availableTables[0];
        combinedCap: number;
        waste: number;
        sameZone: boolean;
      }
      const pairs: PairCandidate[] = [];

      for (let i = 0; i < availableTables.length; i++) {
        for (let j = i + 1; j < availableTables.length; j++) {
          const t1 = availableTables[i];
          const t2 = availableTables[j];
          if (!t1 || !t2) continue;

          // Neither table alone should be large enough (both must be genuinely needed)
          if (t1.capacity >= partySize || t2.capacity >= partySize) continue;

          const combinedCap = t1.capacity + t2.capacity;
          if (combinedCap >= partySize) {
            const waste = combinedCap - partySize;
            const sameZone = t1.zone_id && t2.zone_id ? t1.zone_id === t2.zone_id : false;
            pairs.push({ t1, t2, combinedCap, waste, sameZone });
          }
        }
      }

      pairs.sort((a, b) => {
        if (a.sameZone !== b.sameZone) return a.sameZone ? -1 : 1;
        if (a.waste !== b.waste) return a.waste - b.waste;
        return a.combinedCap - b.combinedCap;
      });

      for (let idx = 0; idx < Math.min(3, pairs.length); idx++) {
        const pair = pairs[idx];
        if (!pair) continue;
        const zone1 = extractZoneName(pair.t1.restaurant_zones);
        const zone2 = extractZoneName(pair.t2.restaurant_zones);
        const zoneLabel = pair.sameZone ? (zone1 || 'Same Zone') : `${zone1 || 'Area 1'} + ${zone2 || 'Area 2'}`;

        recommendations.push({
          table_id: `${pair.t1.id}+${pair.t2.id}`,
          table_number: `${pair.t1.table_number} + ${pair.t2.table_number}`,
          capacity: pair.combinedCap,
          zone_name: zoneLabel,
          rank: 25 + idx,
          reason: `Combine Table ${pair.t1.table_number} (${pair.t1.capacity} seats) + Table ${pair.t2.table_number} (${pair.t2.capacity} seats) = ${pair.combinedCap} seats`,
          is_combination: true,
          is_shared: false,
          table_ids: [pair.t1.id, pair.t2.id],
          combination_labels: [pair.t1.table_number, pair.t2.table_number],
        });
      }
    }

    // Sort all recommendations by rank
    recommendations.sort((a, b) => a.rank - b.rank);

    return recommendations;
  }

  /**
   * Get queue health - server-side aggregation, no browser fetching of all rows
   */
  static async getQueueHealth(restaurantId: string, actorUserId?: string): Promise<QueueHealth & { scheduledOpen: boolean; nextOpening: { dayOffset: number; dayLabel: string; opensAt: string; opensAt12h: string } | null }> {
    if (actorUserId) {
      await AuthorizationService.requirePermission({ userId: actorUserId, restaurantId, permission: PERMISSIONS.QUEUE_VIEW });
    }
    const supabase = createAdminClient();
    const { data: restaurant, error: restErr } = await supabase.from('restaurants').select('queue_enabled, queue_operating_state, max_queue_capacity, call_timeout_minutes, timezone, status').eq('id', restaurantId).single();
    if (restErr || !restaurant) throw new Error('Restaurant not found');
    const queueEnabled = restaurant.queue_enabled;
    const operatingState = (restaurant as unknown as { queue_operating_state: QueueOperatingState }).queue_operating_state || 'OPEN';
    const maxCapacity = restaurant.max_queue_capacity;
    const tz = (restaurant as unknown as { timezone?: string }).timezone || 'Asia/Kolkata';
    const lifecycle = (restaurant as unknown as { status?: string }).status || 'ACTIVE';

    // Parallel aggregates
    const [
      activeRes,
      waitingRes,
      takeawayActiveRes,
      takeawayWaitingRes,
      notifiedRes,
      calledRes,
      seatedRes,
      noShowRes,
      oldestRes,
      tablesRes,
    ] = await Promise.all([
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).in('status', ['WAITING','NOTIFIED','CALLED']),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'WAITING'),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).in('status', ['WAITING','NOTIFIED','CALLED']).eq('queue_type', 'TAKEAWAY'),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'WAITING').eq('queue_type', 'TAKEAWAY'),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'NOTIFIED'),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'CALLED'),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'SEATED'),
      supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'NO_SHOW').gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString()),
      supabase.from('queue_entries').select('joined_at').eq('restaurant_id', restaurantId).eq('status', 'WAITING').order('joined_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('restaurant_tables').select('status').eq('restaurant_id', restaurantId).eq('is_archived', false),
    ]);

    let overdueCount = 0;
    try {
      const timeoutMins = restaurant.call_timeout_minutes || 15;
      const { count } = await supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'CALLED').lt('called_at', new Date(Date.now() - timeoutMins*60*1000).toISOString());
      overdueCount = count || 0;
    } catch { overdueCount = 0; }

    const activeCount = activeRes.count || 0;
    const waitingCount = waitingRes.count || 0;
    const takeawayActiveCount = takeawayActiveRes.count || 0;
    const takeawayWaitingCount = takeawayWaitingRes.count || 0;
    const dineInActiveCount = Math.max(0, activeCount - takeawayActiveCount);
    const dineInWaitingCount = Math.max(0, waitingCount - takeawayWaitingCount);
    const notifiedCount = notifiedRes.count || 0;
    const calledCount = calledRes.count || 0;
    const seatedCount = seatedRes.count || 0;
    const noShowCountToday = noShowRes.count || 0;
    // maybeSingle() returns { data: row | null } — the row itself holds joined_at
    const oldestRow = (oldestRes as unknown as { data: { joined_at: string } | null }).data;
    const oldestWaitingAgeMins = oldestRow?.joined_at ? Math.floor((Date.now() - new Date(oldestRow.joined_at).getTime())/60000) : null;
    const tables = (tablesRes as unknown as { data: Array<{ status: string }> | null })?.data || [];
    const availableTables = tables.filter((t: { status: string }) => t.status === 'AVAILABLE').length;
    const occupiedTables = tables.filter((t: { status: string }) => t.status === 'OCCUPIED').length;
    const cleaningTables = tables.filter((t: { status: string }) => t.status === 'CLEANING').length;
    const reservedTables = tables.filter((t: { status: string }) => t.status === 'RESERVED').length;
    const outOfServiceTables = tables.filter((t: { status: string }) => t.status === 'OUT_OF_SERVICE').length;
    const totalTables = tables.length;

    // Calculate avg wait via ETA service if needed (simplified: use oldest waiting)
    let avgWaitMins: number | null = null;
    if (activeCount > 0 && oldestWaitingAgeMins !== null) {
      avgWaitMins = oldestWaitingAgeMins;
    }

    const isFull = activeCount >= maxCapacity;

    // Scheduled hours (read-only for health; authoritative join still enforced in DB)
    let scheduledOpen = true;
    let nextOpening: { dayOffset: number; dayLabel: string; opensAt: string; opensAt12h: string } | null = null;
    try {
      const { QueueScheduleService } = await import('@/lib/services/queue-schedule-service');
      const schedule = await QueueScheduleService.getSchedule(restaurantId);
      const { getLocalDayTime, isOpenBySchedule } = await import('@/lib/services/queue-schedule-service');
      const { dow, minutes } = getLocalDayTime(tz);
      scheduledOpen = isOpenBySchedule(schedule, dow, minutes);
      nextOpening = QueueScheduleService.getNextOpening(schedule, tz);
    } catch { scheduledOpen = true; }

    // Health classification priority: lifecycle/disabled CLOSED > manual PAUSED > manual CLOSED > scheduled CLOSED > CRITICAL > BUSY > EMPTY > HEALTHY
    // Manual PAUSED/CLOSED take precedence over schedule (schedule never reopens a paused queue).
    let health: QueueHealthState = 'HEALTHY';
    let healthReason = 'Queue is healthy';
    if (lifecycle !== 'ACTIVE' || !queueEnabled || operatingState === 'CLOSED') {
      health = 'CLOSED';
      healthReason = lifecycle !== 'ACTIVE' ? 'Restaurant unavailable' : !queueEnabled ? 'Queue is closed' : 'Queue is closed';
    } else if (operatingState === 'PAUSED') {
      health = 'PAUSED';
      healthReason = 'Queue is paused';
    } else if (!scheduledOpen) {
      health = 'CLOSED';
      healthReason = nextOpening ? `Closed · Opens ${nextOpening.dayOffset === 0 ? 'today' : nextOpening.dayLabel} ${nextOpening.opensAt12h}` : 'Closed · Outside operating hours';
    } else if (activeCount === 0) {
      health = 'EMPTY';
      healthReason = 'No active queue';
    } else if (activeCount >= maxCapacity * 0.9 || overdueCount > 0 || (activeCount > 0 && availableTables === 0)) {
      health = 'CRITICAL';
      if (overdueCount > 0) healthReason = `${overdueCount} overdue called`;
      else if (availableTables === 0) healthReason = 'No available tables';
      else healthReason = `Queue ${Math.round(activeCount/maxCapacity*100)}% full`;
    } else if (activeCount >= maxCapacity * 0.6) {
      health = 'BUSY';
      healthReason = `Queue ${Math.round(activeCount/maxCapacity*100)}% full`;
    }

    return {
      activeCount, waitingCount, notifiedCount, calledCount, seatedCount, noShowCountToday,
      avgWaitMins, oldestWaitingAgeMins, overdueCount,
      availableTables, occupiedTables, cleaningTables, reservedTables, outOfServiceTables, totalTables,
      operatingState, queueEnabled, isFull, health, healthReason, scheduledOpen, nextOpening,
      dineInWaitingCount, takeawayWaitingCount, dineInActiveCount, takeawayActiveCount,
    };
  }

  /**
   * Today's business-day queue summary for dashboard secondary metrics.
   * Single lightweight query scoped to entries created since the 5 AM
   * business-day cutoff (falls back to local midnight). Guests seated uses
   * seat-time headcount (actual_guests) with party_size fallback.
   * Read-only aggregation — no permission beyond caller context needed.
   */
  static async getTodayQueueSummary(restaurantId: string): Promise<{
    seatedGroups: number;
    seatedGuests: number;
    noShows: number;
    cancelled: number;
  }> {
    const supabase = createAdminClient();
    let cutoffISO: string | null = null;
    try {
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('timezone')
        .eq('id', restaurantId)
        .single();
      const { data: cutoff } = await supabase.rpc('get_recent_5am_cutoff', {
        p_timezone: (restaurant as unknown as { timezone?: string } | null)?.timezone || 'UTC',
      });
      if (cutoff) cutoffISO = cutoff as string;
    } catch {
      cutoffISO = null;
    }
    if (!cutoffISO) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      cutoffISO = start.toISOString();
    }

    const { data, error } = await supabase
      .from('queue_entries')
      .select('status, party_size, actual_guests')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', cutoffISO);
    if (error || !data) {
      return { seatedGroups: 0, seatedGuests: 0, noShows: 0, cancelled: 0 };
    }
    let seatedGroups = 0;
    let seatedGuests = 0;
    let noShows = 0;
    let cancelled = 0;
    for (const e of data as Array<{ status: string; party_size: number; actual_guests: number | null }>) {
      if (e.status === 'SEATED') {
        seatedGroups += 1;
        seatedGuests += e.actual_guests ?? e.party_size ?? 0;
      } else if (e.status === 'NO_SHOW') {
        noShows += 1;
      } else if (e.status === 'CANCELLED') {
        cancelled += 1;
      }
    }
    return { seatedGroups, seatedGuests, noShows, cancelled };
  }

  /**
   * Pure, dependency-free fallback health computed from already-fetched rows.
   * NEVER throws — used by pages so a health failure can never crash the UI.
   * Same classification priority as getQueueHealth, without schedule lookup
   * (scheduledOpen defaults to true when unknown).
   */
  static buildFallbackQueueHealth(input: {
    restaurant: {
      queue_enabled?: boolean | null;
      queue_operating_state?: string | null;
      max_queue_capacity?: number | null;
      call_timeout_minutes?: number | null;
      status?: string | null;
    };
    activeEntries: Array<{ status: string; joined_at?: string; called_at?: string | null; created_at?: string }>;
    tables: Array<{ status: string }>;
  }): QueueHealth & { scheduledOpen: boolean; nextOpening: null } {
    try {
      const queueEnabled = input.restaurant.queue_enabled ?? true;
      const operatingState = ((input.restaurant.queue_operating_state || 'OPEN') as QueueOperatingState);
      const maxCapacity = input.restaurant.max_queue_capacity ?? 100;
      const timeoutMins = input.restaurant.call_timeout_minutes ?? 15;
      const lifecycle = input.restaurant.status || 'ACTIVE';
      const now = Date.now();

      const entries = Array.isArray(input.activeEntries) ? input.activeEntries : [];
      const tables = Array.isArray(input.tables) ? input.tables : [];

      const waitingCount = entries.filter((e) => e.status === 'WAITING').length;
      const notifiedCount = entries.filter((e) => e.status === 'NOTIFIED').length;
      const calledCount = entries.filter((e) => e.status === 'CALLED').length;
      const activeCount = waitingCount + notifiedCount + calledCount;
      const takeawayActiveCount = entries.filter((e) => ['WAITING', 'NOTIFIED', 'CALLED'].includes(e.status) && (e as unknown as { queue_type?: string }).queue_type === 'TAKEAWAY').length;
      const takeawayWaitingCount = entries.filter((e) => e.status === 'WAITING' && (e as unknown as { queue_type?: string }).queue_type === 'TAKEAWAY').length;
      const dineInActiveCount = Math.max(0, activeCount - takeawayActiveCount);
      const dineInWaitingCount = Math.max(0, waitingCount - takeawayWaitingCount);
      const seatedCount = entries.filter((e) => e.status === 'SEATED').length;
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const noShowCountToday = entries.filter((e) => {
        if (e.status !== 'NO_SHOW') return false;
        if (!e.created_at) return true;
        const t = new Date(e.created_at).getTime();
        return Number.isNaN(t) || t >= dayAgo;
      }).length;

      const waitingAges = entries
        .filter((e) => e.status === 'WAITING' && e.joined_at)
        .map((e) => now - new Date(e.joined_at as string).getTime())
        .filter((ms) => !Number.isNaN(ms) && ms >= 0);
      const oldestWaitingAgeMins = waitingAges.length > 0 ? Math.floor(Math.max(...waitingAges) / 60000) : null;

      const overdueCount = entries.filter((e) => {
        if (e.status !== 'CALLED' || !e.called_at) return false;
        const calledMs = new Date(e.called_at).getTime();
        if (Number.isNaN(calledMs)) return false;
        return now - calledMs > timeoutMins * 60 * 1000;
      }).length;

      const availableTables = tables.filter((t) => t.status === 'AVAILABLE').length;
      const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;
      const cleaningTables = tables.filter((t) => t.status === 'CLEANING').length;
      const reservedTables = tables.filter((t) => t.status === 'RESERVED').length;
      const outOfServiceTables = tables.filter((t) => t.status === 'OUT_OF_SERVICE').length;
      const totalTables = tables.length;

      const avgWaitMins = activeCount > 0 && oldestWaitingAgeMins !== null ? oldestWaitingAgeMins : null;
      const isFull = activeCount >= maxCapacity;

      let health: QueueHealthState = 'HEALTHY';
      let healthReason = 'Queue is healthy';
      if (lifecycle !== 'ACTIVE' || !queueEnabled || operatingState === 'CLOSED') {
        health = 'CLOSED';
        healthReason = lifecycle !== 'ACTIVE' ? 'Restaurant unavailable' : 'Queue is closed';
      } else if (operatingState === 'PAUSED') {
        health = 'PAUSED';
        healthReason = 'Queue is paused';
      } else if (activeCount === 0) {
        health = 'EMPTY';
        healthReason = 'No active queue';
      } else if (activeCount >= maxCapacity * 0.9 || overdueCount > 0 || (activeCount > 0 && availableTables === 0)) {
        health = 'CRITICAL';
        if (overdueCount > 0) healthReason = `${overdueCount} overdue called`;
        else if (availableTables === 0) healthReason = 'No available tables';
        else healthReason = `Queue ${Math.round((activeCount / maxCapacity) * 100)}% full`;
      } else if (activeCount >= maxCapacity * 0.6) {
        health = 'BUSY';
        healthReason = `Queue ${Math.round((activeCount / maxCapacity) * 100)}% full`;
      }

      return {
        activeCount, waitingCount, notifiedCount, calledCount, seatedCount, noShowCountToday,
        avgWaitMins, oldestWaitingAgeMins, overdueCount,
        availableTables, occupiedTables, cleaningTables, reservedTables, outOfServiceTables, totalTables,
        operatingState, queueEnabled, isFull, health, healthReason, scheduledOpen: true, nextOpening: null,
        dineInWaitingCount, takeawayWaitingCount, dineInActiveCount, takeawayActiveCount,
      };
    } catch {
      // Absolute last resort — a health card must never crash the page
      return {
        activeCount: 0, waitingCount: 0, notifiedCount: 0, calledCount: 0, seatedCount: 0, noShowCountToday: 0,
        avgWaitMins: null, oldestWaitingAgeMins: null, overdueCount: 0,
        availableTables: 0, occupiedTables: 0, cleaningTables: 0, reservedTables: 0, outOfServiceTables: 0, totalTables: 0,
        operatingState: 'OPEN' as QueueOperatingState, queueEnabled: true, isFull: false,
        health: 'EMPTY' as QueueHealthState, healthReason: 'No active queue',
        scheduledOpen: true, nextOpening: null,
      };
    }
  }

  /**
   * Customer marks that they will be late (e.g. +10 mins).
   * Records event in queue_events and triggers chat message.
   */
  static async recordCustomerLate(rawToken: string, delayMinutes: number, note = '') {
    if (!rawToken) throw new Error('MISSING_TOKEN');
    const tokenHash = hashQueueToken(rawToken);
    const supabase = createAdminClient();

    const { data: entry, error } = await supabase
      .from('queue_entries')
      .select('id, restaurant_id, customer_name, status')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error || !entry) {
      throw new Error('QUEUE_ENTRY_NOT_FOUND');
    }

    if (!['WAITING', 'NOTIFIED', 'CALLED'].includes(entry.status)) {
      throw new Error(`CANNOT_MARK_LATE: Status is ${entry.status}`);
    }

    const safeDelay = Math.min(60, Math.max(1, Number(delayMinutes) || 10));
    const safeNote = String(note || '').slice(0, 300);

    const nowIso = new Date().toISOString();

    // 1. Update queue_entries to record delay response and touch updated_at for Realtime broadcast
    try {
      await supabase
        .from('queue_entries')
        .update({
          call_response: 'DELAY_REQUESTED',
          call_responded_at: nowIso,
          call_delay_minutes: safeDelay,
          updated_at: nowIso,
        })
        .eq('id', entry.id);
    } catch {
      // Non-blocking fallback
    }

    // 2. Insert CUSTOMER_LATE event
    await supabase.from('queue_events').insert({
      restaurant_id: entry.restaurant_id,
      queue_entry_id: entry.id,
      event_type: 'CUSTOMER_LATE',
      metadata: {
        delayMinutes: safeDelay,
        note: safeNote,
        reportedAt: nowIso,
      },
    });

    // 3. Insert chat message announcement
    const chatMsg = `Customer reported running ~${safeDelay}m late${safeNote ? `: "${safeNote}"` : ''}`;
    await supabase.from('queue_events').insert({
      restaurant_id: entry.restaurant_id,
      queue_entry_id: entry.id,
      event_type: 'CHAT_MESSAGE',
      metadata: {
        sender: 'customer',
        senderName: entry.customer_name || 'Guest',
        message: chatMsg,
        createdAt: nowIso,
      },
    });

    return {
      success: true,
      entryId: entry.id,
      delayMinutes: safeDelay,
      note: safeNote,
    };
  }

  /**
   * Records customer decision to a table call (ACCEPTED, DELAY_REQUESTED, DECLINED).
   * Server-authoritative atomic RPC execution with token authentication and timeout check.
   */
  static async respondToCall(
    rawToken: string,
    response: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED',
    delayMinutes?: number
  ) {
    if (!rawToken) throw new Error('MISSING_TOKEN');
    const tokenHash = hashQueueToken(rawToken);
    const supabase = createAdminClient();

    // 1. Fetch entry to verify existence, status, called_at, and timeout
    const { data: entry, error: fetchErr } = await supabase
      .from('queue_entries')
      .select('id, restaurant_id, status, token_hash, called_at, restaurants(call_timeout_minutes)')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (fetchErr || !entry) {
      throw new Error('QUEUE_ENTRY_NOT_FOUND');
    }

    if (entry.status !== 'CALLED') {
      throw new Error(`CANNOT_RESPOND: Entry is in status ${entry.status}`);
    }

    const restObj = entry.restaurants as unknown as { call_timeout_minutes?: number } | null;
    const timeoutMins = restObj?.call_timeout_minutes ?? 15;

    // Check expiration
    if (entry.called_at) {
      const elapsedMs = Date.now() - new Date(entry.called_at).getTime();
      if (elapsedMs > timeoutMins * 60 * 1000) {
        throw new Error('CALL_EXPIRED');
      }
    }

    // 2. Call atomic DB function first
    let resultData: {
      success: boolean;
      queueEntryId: string;
      status: string;
      callResponse: 'ACCEPTED' | 'DELAY_REQUESTED' | 'DECLINED';
      callRespondedAt: string;
      callDelayMinutes?: number | null;
      idempotent?: boolean;
    } | null = null;

    try {
      const { data, error: rpcErr } = await supabase.rpc('respond_to_call_atomic', {
        p_queue_entry_id: entry.id,
        p_token_hash: tokenHash,
        p_response: response,
        p_delay_minutes: delayMinutes || null,
      });

      if (!rpcErr && data) {
        resultData = data as unknown as typeof resultData;
      } else if (rpcErr) {
        const msg = rpcErr.message || '';
        if (msg.includes('CALL_EXPIRED')) throw new Error('CALL_EXPIRED');
        if (msg.includes('UNAUTHORIZED')) throw new Error('UNAUTHORIZED');
        if (msg.includes('QUEUE_ENTRY_NOT_CALLED')) throw new Error('QUEUE_ENTRY_NOT_CALLED');
        // If RPC function does not exist in schema, proceed to fallback below
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (['CALL_EXPIRED', 'UNAUTHORIZED', 'QUEUE_ENTRY_NOT_CALLED'].includes(msg)) {
        throw err;
      }
    }

    // 3. Resilient fallback execution if RPC is not deployed yet on remote DB
    if (!resultData) {
      const now = new Date().toISOString();
      const safeDelay = Math.min(60, Math.max(1, Number(delayMinutes) || 10));

      if (response === 'DECLINED') {
        const updatePayload: Record<string, unknown> = {
          status: 'CANCELLED',
          cancelled_at: now,
          updated_at: now,
        };
        try {
          await supabase
            .from('queue_entries')
            .update({ ...updatePayload, call_response: 'DECLINED', call_responded_at: now })
            .eq('id', entry.id);
        } catch {
          await supabase.from('queue_entries').update(updatePayload).eq('id', entry.id);
        }

        try {
          await supabase.from('queue_events').insert({
            restaurant_id: entry.restaurant_id,
            queue_entry_id: entry.id,
            event_type: 'QUEUE_CANCELLED',
            metadata: { reason: 'CUSTOMER_DECLINED_CALL', responded_at: now },
          });
        } catch {
          // Non-blocking event log
        }

        resultData = {
          success: true,
          queueEntryId: entry.id,
          status: 'CANCELLED',
          callResponse: 'DECLINED',
          callRespondedAt: now,
          callDelayMinutes: null,
        };
      } else if (response === 'DELAY_REQUESTED') {
        try {
          await supabase
            .from('queue_entries')
            .update({
              call_response: 'DELAY_REQUESTED',
              call_responded_at: now,
              call_delay_minutes: safeDelay,
              updated_at: now,
            })
            .eq('id', entry.id);
        } catch {
          await supabase.from('queue_entries').update({ updated_at: now }).eq('id', entry.id);
        }

        try {
          await supabase.from('queue_events').insert([
            {
              restaurant_id: entry.restaurant_id,
              queue_entry_id: entry.id,
              event_type: 'CUSTOMER_LATE',
              metadata: { delayMinutes: safeDelay, reportedAt: now, fromCallResponse: true },
            },
            {
              restaurant_id: entry.restaurant_id,
              queue_entry_id: entry.id,
              event_type: 'QUEUE_CALL_DELAY_REQUESTED',
              metadata: { delayMinutes: safeDelay, responded_at: now },
            },
          ]);
        } catch {
          // Non-blocking event log
        }

        resultData = {
          success: true,
          queueEntryId: entry.id,
          status: 'CALLED',
          callResponse: 'DELAY_REQUESTED',
          callRespondedAt: now,
          callDelayMinutes: safeDelay,
        };
      } else {
        // ACCEPTED
        try {
          await supabase
            .from('queue_entries')
            .update({
              call_response: 'ACCEPTED',
              call_responded_at: now,
              updated_at: now,
            })
            .eq('id', entry.id);
        } catch {
          await supabase.from('queue_entries').update({ updated_at: now }).eq('id', entry.id);
        }

        try {
          await supabase.from('queue_events').insert({
            restaurant_id: entry.restaurant_id,
            queue_entry_id: entry.id,
            event_type: 'QUEUE_CALL_ACCEPTED',
            metadata: { response: 'ACCEPTED', responded_at: now },
          });
        } catch {
          // Non-blocking event log
        }

        resultData = {
          success: true,
          queueEntryId: entry.id,
          status: 'CALLED',
          callResponse: 'ACCEPTED',
          callRespondedAt: now,
          callDelayMinutes: null,
        };
      }
    }

    return resultData;
  }

  /**
   * Send a chat message between customer and restaurant staff.
   */
  static async sendQueueChatMessage(params: {
    rawToken?: string;
    queueEntryId?: string;
    restaurantId?: string;
    sender: 'customer' | 'staff';
    senderName?: string;
    message: string;
    actorUserId?: string;
  }) {
    const supabase = createAdminClient();
    let entryId = params.queueEntryId;
    let restaurantId = params.restaurantId;
    let senderName = params.senderName;

    if (params.sender === 'customer') {
      if (!params.rawToken) throw new Error('MISSING_TOKEN');
      const tokenHash = hashQueueToken(params.rawToken);
      const { data: entry } = await supabase
        .from('queue_entries')
        .select('id, restaurant_id, customer_name')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (!entry) throw new Error('QUEUE_ENTRY_NOT_FOUND');
      entryId = entry.id;
      restaurantId = entry.restaurant_id;
      senderName = senderName || entry.customer_name || 'Customer';
    }

    if (!entryId || !restaurantId) {
      throw new Error('MISSING_ENTRY_OR_RESTAURANT');
    }

    const cleanMessage = String(params.message || '').trim().slice(0, 500);
    if (!cleanMessage) {
      throw new Error('EMPTY_MESSAGE');
    }

    const nowIso = new Date().toISOString();

    const { data: inserted, error } = await supabase
      .from('queue_events')
      .insert({
        restaurant_id: restaurantId,
        queue_entry_id: entryId,
        event_type: 'CHAT_MESSAGE',
        actor_user_id: params.actorUserId || null,
        metadata: {
          sender: params.sender,
          senderName: senderName || (params.sender === 'staff' ? 'Host Stand' : 'Guest'),
          message: cleanMessage,
          createdAt: nowIso,
        },
      })
      .select('id, created_at')
      .single();

    if (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }

    // Touch updated_at on queue_entries so Postgres Realtime fires immediately for all clients
    try {
      await supabase
        .from('queue_entries')
        .update({ updated_at: nowIso })
        .eq('id', entryId);
    } catch {
      // Non-blocking fallback
    }

    return {
      success: true,
      id: inserted.id,
      entryId,
      sender: params.sender,
      senderName: senderName || (params.sender === 'staff' ? 'Host Stand' : 'Guest'),
      message: cleanMessage,
      createdAt: inserted.created_at,
    };
  }

  /**
   * Fetch chat messages and late notices for a queue entry.
   */
  static async getQueueChatHistory(queueEntryId: string) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('queue_events')
      .select('id, event_type, metadata, created_at')
      .eq('queue_entry_id', queueEntryId)
      .in('event_type', ['CHAT_MESSAGE', 'CUSTOMER_LATE', 'TABLE_PASSED_TO_NEXT'])
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch chat history: ${error.message}`);
    }

    return (data || []).map((ev) => {
      const meta = (ev.metadata || {}) as Record<string, unknown>;
      return {
        id: ev.id,
        eventType: ev.event_type,
        sender: (meta.sender as 'customer' | 'staff') || 'system',
        senderName: String(meta.senderName || (meta.sender === 'customer' ? 'Customer' : 'Host Stand')),
        message: String(meta.message || ''),
        createdAt: ev.created_at,
      };
    });
  }

  /**
   * Restaurant passes the table to the next customer in line because the current customer is late.
   * Keeps current customer active with held status, and posts notification.
   */
  static async passTableToNextCustomer(entryId: string, restaurantId: string, actorUserId?: string) {
    const supabase = createAdminClient();

    // Verify entry
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('id, customer_name, status, restaurant_id')
      .eq('id', entryId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (!entry) throw new Error('QUEUE_ENTRY_NOT_FOUND');

    // Insert TABLE_PASSED_TO_NEXT event
    await supabase.from('queue_events').insert({
      restaurant_id: restaurantId,
      queue_entry_id: entryId,
      event_type: 'TABLE_PASSED_TO_NEXT',
      actor_user_id: actorUserId || null,
      metadata: {
        reason: 'Customer reported late; host passed table to next waiting guest and held priority',
        passedAt: new Date().toISOString(),
      },
    });

    // Notify customer in chat
    await supabase.from('queue_events').insert({
      restaurant_id: restaurantId,
      queue_entry_id: entryId,
      event_type: 'CHAT_MESSAGE',
      actor_user_id: actorUserId || null,
      metadata: {
        sender: 'staff',
        senderName: 'Host Stand',
        message: "We've seated the next waiting party to keep the floor moving. Your spot is held and you'll be seated as soon as you step in!",
        createdAt: new Date().toISOString(),
      },
    });

    return { success: true, entryId };
  }
}

import { createAdminClient } from '@/lib/db/supabase/admin';
import { OutboxStatus } from '@/types/database.types';

export interface PublishOutboxEventOptions {
  restaurantId: string;
  eventType: string;
  aggregateType: 'QUEUE' | 'ORDER' | 'PAYMENT' | 'STAFF' | 'SYSTEM';
  aggregateId: string;
  payload: Record<string, unknown>;
  maxRetries?: number;
}

export class OutboxService {
  /**
   * Inserts an outbox event atomically.
   */
  static async publishEvent(options: PublishOutboxEventOptions): Promise<string> {
    const supabase = createAdminClient();

    const { data: record, error } = await supabase
      .from('outbox_events')
      .insert({
        restaurant_id: options.restaurantId,
        event_type: options.eventType,
        aggregate_type: options.aggregateType,
        aggregate_id: options.aggregateId,
        payload: options.payload,
        status: 'PENDING' as OutboxStatus,
        retry_count: 0,
        max_retries: options.maxRetries || 5,
        next_attempt_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !record) {
      throw new Error(`Failed to publish outbox event: ${error?.message}`);
    }

    return record.id;
  }

  /**
   * Atomically claims a batch of pending outbox events for exclusive processing.
   *
   * Uses an UPDATE…RETURNING CTE with FOR UPDATE SKIP LOCKED at the database
   * level. The claimed events are immediately transitioned to PROCESSING status
   * before the function returns — so concurrent workers will NEVER receive the
   * same events, even if they call this simultaneously.
   *
   * Returned events already have status = 'PROCESSING'.
   */
  static async getPendingEvents(limit = 20) {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc('claim_outbox_events', {
      p_limit: limit,
    });

    if (error) {
      throw new Error(`Failed to claim outbox events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Recovers stale PROCESSING events where the worker crashed or the processing
   * lease expired. Transitions eligible events back to PENDING with incremented
   * retry_count, or to terminal FAILED if max_retries is exhausted.
   *
   * Lease duration:
   *   Default: 30 minutes. A PROCESSING event untouched for 30+ minutes is
   *   considered crashed and eligible for recovery.
   *
   * Recovery behavior:
   *   - retry_count < max_retries: status → PENDING, next_attempt_at = exponential backoff
   *   - retry_count >= max_retries: status → FAILED (terminal)
   *
   * This should be called at the start of each worker batch run to clean up
   * before claiming new events.
   *
   * @param staleAfterMins - Lease duration in minutes (default: 30)
   * @returns Number of events recovered
   */
  static async recoverStaleEvents(staleAfterMins = 30): Promise<number> {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc('recover_stale_outbox_events', {
      p_stale_after_mins: staleAfterMins,
    });

    if (error) {
      throw new Error(`Failed to recover stale outbox events: ${error.message}`);
    }

    return data as number || 0;
  }

  /**
   * Marks a PROCESSING outbox event as successfully COMPLETED.
   */
  static async markCompleted(eventId: string): Promise<void> {
    const supabase = createAdminClient();

    await supabase
      .from('outbox_events')
      .update({
        status: 'COMPLETED' as OutboxStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId);
  }

  /**
   * Marks a PROCESSING outbox event as failed, applying exponential backoff
   * for retry scheduling. Permanently FAILED if max_retries is exhausted.
   *
   * @param eventId       - ID of the outbox event
   * @param errorMessage  - Description of the failure
   * @param currentRetry  - Current retry_count value (before this failure)
   * @param maxRetries    - Maximum allowed retries before terminal FAILED
   */
  static async markFailed(
    eventId: string,
    errorMessage: string,
    currentRetry: number,
    maxRetries: number
  ): Promise<void> {
    const supabase = createAdminClient();

    const nextRetry = currentRetry + 1;
    const isPermanentlyFailed = nextRetry >= maxRetries;
    const newStatus: OutboxStatus = isPermanentlyFailed ? 'FAILED' : 'PENDING';

    // Exponential backoff: (2 ^ retry_count) * 30 seconds, capped at 1 hour
    const backoffSeconds = Math.min(Math.pow(2, nextRetry) * 30, 3600);
    const nextAttemptDate = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    await supabase
      .from('outbox_events')
      .update({
        status: newStatus,
        retry_count: nextRetry,
        last_error: errorMessage,
        next_attempt_at: nextAttemptDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId);
  }
}

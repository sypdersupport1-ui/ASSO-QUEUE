import { OutboxService } from '@/lib/services/outbox-service';
import { NotificationService } from '@/lib/services/notification-service';
import { logger } from '@/lib/logging/logger';

export interface WorkerBatchResult {
  processedCount: number;
  successCount: number;
  failedCount: number;
  recoveredStaleCount: number;
  errors: Array<{ eventId: string; error: string }>;
}

export class NotificationWorker {
  /**
   * Executes a batch run over pending outbox events.
   *
   * Batch lifecycle:
   *   1. Recover stale PROCESSING events (worker crash recovery).
   *      Any event stuck in PROCESSING for > staleAfterMins is eligible.
   *   2. Claim a batch of PENDING/FAILED events atomically (status → PROCESSING).
   *      Concurrent workers cannot claim the same events.
   *   3. Process each claimed event sequentially.
   *   4. Mark each event COMPLETED or FAILED with exponential backoff.
   *
   * @param batchSize      - Number of events to claim per run (default: 20)
   * @param staleAfterMins - Lease duration for stale recovery (default: 30)
   */
  static async runBatch(batchSize = 20, staleAfterMins = 30): Promise<WorkerBatchResult> {
    // Step 1: Recover any stale PROCESSING events from crashed workers
    // This must happen BEFORE claiming new events to avoid double-processing.
    let recoveredStaleCount = 0;
    try {
      recoveredStaleCount = await OutboxService.recoverStaleEvents(staleAfterMins);
      if (recoveredStaleCount > 0) {
        logger.info('Recovered stale outbox events from crashed workers', {
          operation: 'notification_worker_batch',
          metadata: { recoveredStaleCount, staleAfterMins },
        });
      }
    } catch (recoverErr) {
      // Non-fatal: log and continue — stale events will be recovered on next run
      logger.warn('Stale outbox event recovery failed — continuing batch', {
        operation: 'notification_worker_batch',
        metadata: { error: recoverErr instanceof Error ? recoverErr.message : String(recoverErr) },
      });
    }

    // Step 2: Claim pending events (already transitioned to PROCESSING by DB)
    const pendingEvents = await OutboxService.getPendingEvents(batchSize);

    let successCount = 0;
    let failedCount = 0;
    const errors: Array<{ eventId: string; error: string }> = [];

    // Step 3+4: Process each claimed event
    for (const event of pendingEvents) {
      try {
        await NotificationService.processOutboxEvent(event);
        await OutboxService.markCompleted(event.id);
        successCount++;
      } catch (err: unknown) {
        failedCount++;
        const errMsg = err instanceof Error ? err.message : 'Unknown worker execution failure';
        errors.push({ eventId: event.id, error: errMsg });

        await OutboxService.markFailed(
          event.id,
          errMsg,
          event.retry_count,
          event.max_retries
        );

        logger.warn('Outbox event processing failed', {
          operation: 'notification_worker_batch',
          metadata: {
            eventId: event.id,
            eventType: event.event_type,
            retryCount: event.retry_count,
            maxRetries: event.max_retries,
            error: errMsg,
          },
        });
      }
    }

    return {
      processedCount: pendingEvents.length,
      successCount,
      failedCount,
      recoveredStaleCount,
      errors,
    };
  }
}

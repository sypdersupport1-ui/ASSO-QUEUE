import 'server-only';
import { AppError, InternalError } from '@/lib/errors';

export type ServiceSuccess<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ServiceFailure = {
  success: false;
  error: AppError;
};

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

/**
 * Helper to construct successful service operation results.
 */
export function successResult<T>(data: T, meta?: Record<string, unknown>): ServiceSuccess<T> {
  return {
    success: true,
    data,
    meta,
  };
}

/**
 * Helper to construct failed service operation results.
 */
export function failureResult(error: AppError): ServiceFailure {
  return {
    success: false,
    error,
  };
}

/**
 * Base abstract class for future domain services (Phase 2+).
 */
export abstract class BaseDomainService {
  protected handleServiceError(error: unknown, defaultMessage = 'Domain operation failed'): AppError {
    if (error instanceof AppError) {
      return error;
    }
    const message = error instanceof Error ? error.message : defaultMessage;
    return new InternalError(message);
  }
}

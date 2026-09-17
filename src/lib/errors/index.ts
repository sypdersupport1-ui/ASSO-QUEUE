/**
 * Base Application Error class for QueueFlow.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
}

export class AuthenticationError extends AppError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly statusCode = 401;

  constructor(message = 'Authentication required', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class AuthorizationError extends AppError {
  readonly code = 'AUTHORIZATION_ERROR';
  readonly statusCode = 403;

  constructor(message = 'Permission denied', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND_ERROR';
  readonly statusCode = 404;

  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT_ERROR';
  readonly statusCode = 409;
}

export class DomainError extends AppError {
  readonly code = 'DOMAIN_ERROR';
  readonly statusCode = 422;
}

export class DatabaseError extends AppError {
  readonly code = 'DATABASE_ERROR';
  readonly statusCode = 500;

  constructor(message = 'Database operation failed', details?: Record<string, unknown>) {
    // Sanitized: never pass raw database query strings or internal DB errors directly to client
    super(message, details);
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR';
  readonly statusCode = 500;

  constructor(message = 'An unexpected error occurred', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export interface SafeErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Format any thrown error into a safe, client-facing JSON structure.
 * Prevents raw database errors, passwords, or internal stack traces from leaking.
 */
export function toSafeErrorResponse(error: unknown): { status: number; body: SafeErrorResponse } {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  // Fallback for unhandled/unexpected errors
  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal server error occurred',
      },
    },
  };
}

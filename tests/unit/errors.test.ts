import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  toSafeErrorResponse,
} from '@/lib/errors';

describe('Error Architecture', () => {
  it('should instantiate error subclasses with correct codes and status codes', () => {
    const valErr = new ValidationError('Bad request');
    expect(valErr.code).toBe('VALIDATION_ERROR');
    expect(valErr.statusCode).toBe(400);

    const authErr = new AuthenticationError();
    expect(authErr.code).toBe('AUTHENTICATION_ERROR');
    expect(authErr.statusCode).toBe(401);

    const permErr = new AuthorizationError();
    expect(permErr.code).toBe('AUTHORIZATION_ERROR');
    expect(permErr.statusCode).toBe(403);

    const notFoundErr = new NotFoundError();
    expect(notFoundErr.code).toBe('NOT_FOUND_ERROR');
    expect(notFoundErr.statusCode).toBe(404);
  });

  it('should format AppError into safe response structure', () => {
    const err = new ValidationError('Invalid email format', { field: 'email' });
    const { status, body } = toSafeErrorResponse(err);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid email format');
    expect(body.error.details).toEqual({ field: 'email' });
  });

  it('should sanitize raw unhandled errors into generic InternalError without leaking stack traces', () => {
    const rawError = new Error('FATAL DB CONNECTION TIMEOUT: postgresql://user:secret@localhost:5432/db');
    const { status, body } = toSafeErrorResponse(rawError);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An internal server error occurred');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

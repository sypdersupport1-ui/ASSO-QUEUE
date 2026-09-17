import { z } from 'zod';
import { ValidationError } from '@/lib/errors';

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  error: ValidationError;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validates unknown input data against a Zod schema.
 * Throws a ValidationError if strict mode is enabled, or returns a typed ValidationResult.
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  throwOnError = true
): T {
  const parseResult = schema.safeParse(data);

  if (!parseResult.success) {
    const formatted = parseResult.error.format();
    const validationError = new ValidationError('Input validation failed', {
      fieldErrors: formatted,
      issues: parseResult.error.issues,
    });

    if (throwOnError) {
      throw validationError;
    }
  }

  return parseResult.data as T;
}

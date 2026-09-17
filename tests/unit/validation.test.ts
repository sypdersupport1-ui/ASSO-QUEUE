import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateInput } from '@/lib/validation';
import { ValidationError } from '@/lib/errors';

describe('Validation Foundation', () => {
  const schema = z.object({
    name: z.string().min(2),
    age: z.number().positive(),
  });

  it('should return validated data when input matches schema', () => {
    const input = { name: 'QueueFlow', age: 10 };
    const result = validateInput(schema, input);
    expect(result).toEqual(input);
  });

  it('should throw ValidationError when input fails schema', () => {
    const invalidInput = { name: 'A', age: -5 };
    expect(() => validateInput(schema, invalidInput)).toThrow(ValidationError);
  });
});

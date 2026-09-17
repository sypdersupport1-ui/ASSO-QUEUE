import { describe, it, expect } from 'vitest';
import { redactSensitiveData } from '@/lib/logging/redactor';

describe('Logger Secret Redactor', () => {
  it('should redact sensitive keys recursively', () => {
    const inputPayload = {
      user: {
        id: 'usr_123',
        email: 'test@example.com',
        password: 'SuperSecretPassword123!',
      },
      tokens: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        service_role_key: 'secret-key',
      },
    };

    const redacted = redactSensitiveData(inputPayload) as typeof inputPayload;

    expect(redacted.user.id).toBe('usr_123');
    expect(redacted.user.email).toBe('test@example.com');
    expect(redacted.user.password).toBe('[REDACTED]');
    expect(redacted.tokens.access_token).toBe('[REDACTED]');
    expect(redacted.tokens.service_role_key).toBe('[REDACTED]');
  });

  it('should redact standalone token and phone strings', () => {
    expect(redactSensitiveData('Bearer secret_jwt_token')).toBe('[REDACTED_TOKEN]');
    expect(redactSensitiveData('+15551234567')).toBe('[REDACTED_PHONE]');
  });
});

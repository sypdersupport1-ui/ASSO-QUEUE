/**
 * Secret & PII redactor to prevent sensitive data from reaching logs or external sinks.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'auth',
  'service_role_key',
  'supabase_service_role_key',
  'anon_key',
  'api_key',
  'apikey',
  'credit_card',
  'card_number',
  'cvv',
  'ssn',
  'phone',
  'phone_number',
  'customer_phone',
]);

const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;

/**
 * Recursively redact sensitive fields and PII patterns in log payload objects.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact bearer tokens or jwt-like structures if present in string
    if (data.startsWith('Bearer ') || data.startsWith('eyJ')) {
      return '[REDACTED_TOKEN]';
    }
    if (PHONE_REGEX.test(data.trim())) {
      return '[REDACTED_PHONE]';
    }
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  const redactedObj: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      redactedObj[key] = '[REDACTED]';
    } else {
      redactedObj[key] = redactSensitiveData(value);
    }
  }

  return redactedObj;
}

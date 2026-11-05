/**
 * Redaction for audit payloads and log lines.
 *
 * PAN and Aadhaar are regulated personal data (brief §3, §9). They must never
 * reach the audit table, application logs, or the Google Sheet mirror. This
 * module is pure so it can be unit tested — the rule it enforces is one of the
 * few that would be a reportable incident if it silently broke.
 */

export const SENSITIVE_KEYS = new Set([
  'pan',
  'panEncrypted',
  'panLast4',
  'aadhaar',
  'aadhaarEncrypted',
  'aadhaarLast4',
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'dob',
  'secret',
  'privateKey',
  'codeVerifier',
  'authorization',
  'cookie',
]);

const SENSITIVE_KEY_PATTERN =
  /^(?:pan|pan_?(?:encrypted|last4|no|number)|a+dha+r(?:_?(?:encrypted|last4|no|number))?|password(?:_?hash)?|token(?:_?hash)?|dob|date_?of_?birth|secret|session_?secret|cron_?secret|private_?key|code_?verifier|authorization|cookie)$/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key);
}

export const REDACTED = '[redacted]';

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map(redact);

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v);
    }
    return out;
  }

  return value;
}

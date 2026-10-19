const SENSITIVE_KEY = /authorization|cookie|password|token|secret|signature|card|cvv|cvc|pan|paypal-transmission-sig|stripe-signature/i;
const CARD_LIKE = /\b(?:\d[ -]*?){13,19}\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

export function redactString(value: string): string {
  return value.replace(BEARER, 'Bearer [redacted]').replace(CARD_LIKE, '[redacted]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(nested, depth + 1);
    }
    return output;
  }
  return value;
}

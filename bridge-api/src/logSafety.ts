/**
 * Log hygiene: secrets must never reach a log line, and health/PII payloads
 * stay out of application logs.
 *
 * WHY (2026-10-16 audit): bridge-api.out.log contained the WHOOP and Withings
 * client secrets (~464 occurrences), refresh tokens, Bearer access tokens, and a
 * full WHOOP token-exchange response. Cause: `logger.error({ err })` on an axios
 * error serializes `err.config` — the request body (refresh_token=…&
 * client_secret=…) and headers (Authorization: Bearer …). Separately, routes
 * logged raw recovery/sleep/cycle payloads and request bodies.
 *
 * Defense in depth:
 *  - safeErr(): the `err` serializer keeps only type/message/code/status and a
 *    scrubbed response body; axios config/request/headers are never serialized.
 *  - scrubSecrets(): applied to EVERY log object (pino formatters.log): any key
 *    that looks like a credential is replaced, and credential-shaped substrings
 *    inside strings (Bearer …, refresh_token=…, OAuth ?code=…, Telegram bot
 *    tokens, Google ya29./GOCSPX-) are masked.
 *  - HEALTH_KEYS: health/PII fields are redacted from logs entirely.
 */

export const REDACTED = '[REDACTED]';

const SECRET_KEY_RE =
  /^(access_?token|refresh_?token|id_?token|token|client_?secret|secret|password|authorization|api_?key|x-bridge-key|cookie|set-cookie)$/i;

/** Health / PII fields that never belong in an application log. */
export const HEALTH_KEYS = new Set([
  'recovery', 'sleep', 'cycle', 'strain', 'hrv', 'restingHeartRate', 'resting_heart_rate',
  'measurement', 'measurements', 'weight', 'weightLbs', 'bodyFat', 'bodyFatPercent', 'muscleMass',
  'muscleMassLbs', 'body', 'response', 'attendees', 'description', 'events', 'snapshot',
  'painArea', 'painSeverity', 'note', 'notes', 'data', 'rows', 'values', 'email',
]);

const STRING_PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/((?:access|refresh|id)_token|client_secret|code|state|password|api_key)(=|":\s*"|:\s*)[^&"\s,}]+/gi, `$1$2${REDACTED}`],
  [/(api\.telegram\.org\/(?:file\/)?bot)[0-9]+:[A-Za-z0-9_-]+/gi, `$1${REDACTED}`],
  [/\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b/g, REDACTED], // Telegram bot token
  [/\bya29\.[A-Za-z0-9._-]{10,}/g, REDACTED], // Google access token
  [/\bGOCSPX-[A-Za-z0-9_-]{10,}/g, REDACTED], // Google client secret
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED], // Anthropic key
];

export function scrubText(s: string): string {
  let out = s;
  for (const [re, rep] of STRING_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function scrubSecrets(value: unknown, opts: { health?: boolean } = {}, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, opts, depth + 1));
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) return safeErr(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) out[k] = REDACTED;
    else if (opts.health && HEALTH_KEYS.has(k) && depth >= 0) out[k] = REDACTED;
    else out[k] = scrubSecrets(v, opts, depth + 1);
  }
  return out;
}

/**
 * Error serializer. Never serializes axios `config` / `request` / response
 * headers (where the credentials live); keeps what's useful for debugging.
 */
export function safeErr(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { message: scrubText(String(err)) };
  const e = err as any;
  // Already serialized by safeErr (pino runs formatters.log before serializers) — keep as is.
  if (!(err instanceof Error) && typeof e.type === 'string' && typeof e.message === 'string') return e;
  // Callers often log `{ err: error.response?.data || error }` — a plain provider
  // body, not an Error. Keep it (scrubbed) instead of reducing it to "Object".
  if (!(err instanceof Error) && e.message == null && e.response == null) {
    return { responseData: scrubSecrets(err, { health: true }) };
  }
  const out: Record<string, unknown> = {
    type: e.name ?? e.constructor?.name ?? 'Error',
    message: scrubText(String(e.message ?? '')),
  };
  if (e.code != null) out.code = e.code;
  if (e.statusCode != null) out.statusCode = e.statusCode;
  const status = e.response?.status ?? e.status;
  if (status != null) out.status = status;
  // Provider error bodies are small and useful (e.g. {error:"invalid_grant"}),
  // but scrub them: some echo the request.
  if (e.response?.data != null) out.responseData = scrubSecrets(e.response.data, { health: true });
  if (typeof e.stack === 'string') out.stack = scrubText(e.stack.split('\n').slice(0, 6).join('\n'));
  return out;
}

/** Strip OAuth/secret query params from a logged URL (e.g. /auth/x/callback?code=…). */
export function scrubUrl(url: string): string {
  return String(url ?? '').replace(/([?&])(code|state|token|access_token|refresh_token|key|api_key)=[^&]*/gi, `$1$2=${REDACTED}`);
}

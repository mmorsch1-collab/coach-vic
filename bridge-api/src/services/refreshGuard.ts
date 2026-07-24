import { logger } from '../logger.js';

/**
 * Shared helpers for hardening OAuth refresh-token rotation.
 *
 * Background: WHOOP and Withings (and to a lesser degree Strava/Google) issue
 * SINGLE-USE refresh tokens that ROTATE on every refresh. Two problems follow:
 *
 *  1. Concurrency: the background TokenRefreshService and on-demand refresh (when
 *     a token is within ~5 min of expiry) can fire at the same time. Both read
 *     the same stored refresh token; the first POST rotates (consumes) it, the
 *     second POST then sends an already-consumed token and fails. To avoid this
 *     we run at most ONE refresh per provider at a time (single-flight): the
 *     second caller awaits the first caller's in-flight promise.
 *
 *  2. Over-eager deletion: previously ANY refresh error wiped the stored tokens,
 *     so a transient network blip / 5xx / 429 / rotation race forced a full
 *     browser re-auth. We now only clear tokens when the provider EXPLICITLY
 *     says the grant is dead (invalid_grant / expired_token), and otherwise keep
 *     the tokens and surface a retryable error.
 */

/** Per-provider in-flight refresh promise (single-flight mutex). */
type Provider = 'google' | 'whoop' | 'withings' | 'strava';
const inFlight: Partial<Record<Provider, Promise<unknown>>> = {};

/**
 * Run `fn` for `provider` under a single-flight lock. If a refresh for the same
 * provider is already running, return that in-flight promise instead of starting
 * a second one. This prevents concurrent callers from each POSTing a refresh and
 * racing on the single-use refresh token.
 */
export async function withRefreshLock<T>(provider: Provider, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight[provider];
  if (existing) {
    logger.debug({ provider }, 'Refresh already in flight, awaiting existing refresh');
    return existing as Promise<T>;
  }

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      // Clear the slot so the next refresh after this one can proceed.
      delete inFlight[provider];
    }
  })();

  inFlight[provider] = promise;
  return promise;
}

/**
 * Error thrown when a refresh failed for a TRANSIENT reason (network error,
 * timeout, 5xx, 429, or a rotation race). Stored tokens are KEPT; the caller may
 * retry later. This is distinct from a permanent invalid_grant failure.
 */
export class RetryableRefreshError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'RetryableRefreshError';
  }
}

/**
 * Decide whether a failed refresh means the grant is permanently dead (so we
 * should clear tokens and require re-auth) vs. a transient failure (keep tokens).
 *
 * Returns true ONLY when the provider explicitly signals an invalid/expired
 * grant. Everything else (no HTTP response = network error/timeout, 5xx, 429,
 * or any other status) is treated as transient.
 */
export function isInvalidGrantError(error: any): boolean {
  const response = error?.response;

  // No response at all => network error / timeout / DNS / connection reset.
  // Never destructive: keep tokens.
  if (!response) {
    return false;
  }

  const status: number | undefined = response.status;

  // Server-side / throttling failures are transient by definition.
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return false;
  }

  const data = response.data ?? {};

  // OAuth2 standard (Google, WHOOP, Strava): error === 'invalid_grant'.
  // Some providers also use 'invalid_token' / 'unauthorized_client' for a dead grant.
  const oauthError: string | undefined =
    typeof data.error === 'string' ? data.error : undefined;
  if (
    oauthError === 'invalid_grant' ||
    oauthError === 'invalid_token' ||
    oauthError === 'unauthorized_client'
  ) {
    return true;
  }
  // Any OTHER explicit OAuth error code (invalid_request, invalid_client,
  // temporarily_unavailable, server_error, …) is a request/client/server
  // problem — NOT a dead grant. Observed 2026-06-11: WHOOP's half-up gateway
  // returned 400 {error:"invalid_request"} during a 503 outage and the old
  // bare-4xx fallback below nuked a perfectly valid refresh token. When the
  // provider names a non-grant error, keep tokens and retry.
  if (oauthError !== undefined) {
    return false;
  }

  // Withings wraps errors in a JSON body even on HTTP 200:
  //   { status: <nonzero>, body: { error: '...' } }
  // Auth/permission failures use status code 401 in the Withings "status" field.
  const withingsStatus = typeof data.status === 'number' ? data.status : undefined;
  if (withingsStatus !== undefined && withingsStatus !== 0) {
    // 401 = invalid/expired token (dead grant). Other non-zero statuses (e.g. 601
    // rate-limit) are transient — don't wipe a still-valid refresh token.
    return withingsStatus === 401;
  }

  // HTTP-level auth failure on a TOKEN endpoint => the refresh token is dead.
  // A refresh request that returns 400/401/403 effectively never recovers (the
  // grant is invalid/revoked); treating it as transient would loop forever and
  // never prompt re-auth. Transient causes (network/timeout/5xx/429) are already
  // returned as non-fatal above, so reaching here with a 4xx means a dead grant.
  // This is safe because the per-provider single-flight lock prevents the
  // rotation race that previously produced spurious invalid_grant responses.
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }

  // Any other status: be conservative and treat as transient (keep tokens).
  return false;
}

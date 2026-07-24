import { config } from '../config.js';
import { logger } from '../logger.js';
import { bridge, isAuthError } from '../bridge/client.js';
import { JsonStore } from '../state/jsonStore.js';
import { minutesSince } from '../util/time.js';
import { inQuietHours } from './proactiveState.js';

/**
 * Self-healing / watchdog for the data layer. Runs on a schedule and:
 *  - confirms the Bridge is reachable,
 *  - confirms each provider is still authenticated (by exercising a real endpoint),
 *  - if something is broken, sends ONE throttled Telegram alert with a re-auth link,
 *    so a genuine provider-side disconnect surfaces as a one-tap fix instead of
 *    silently failing.
 *
 * It does NOT try to silently re-auth (that needs human consent) and it does NOT
 * spam: at most one alert per issue per 24h. Process crashes are handled by PM2
 * (autorestart) and the OS watchdog; this covers the auth/data layer.
 */

interface HealState {
  lastAlertMsByKey: Record<string, number>;
  /** Consecutive non-auth ("transient") probe failures per provider. */
  transientStreakByKey?: Record<string, number>;
}
const store = new JsonStore<HealState>('self-heal-state.json', {
  lastAlertMsByKey: {},
  transientStreakByKey: {},
});

const ALERT_COOLDOWN_MIN = 24 * 60; // one alert per issue per day

/**
 * How many consecutive "transient" failures before we stop believing it.
 * The probe runs hourly, so 3 ≈ 3 hours of a provider being continuously
 * unusable — well past any real blip.
 *
 * This exists because of a genuine silent outage on 2026-07-23: WHOOP's refresh
 * returned OAuth `invalid_request`, which the Bridge classifies as retryable
 * (deliberately — a 2026-06-11 incident showed WHOOP emits it during outages,
 * and treating it as a dead grant wiped a valid token). But nothing ever
 * escalated when it did NOT clear, so WHOOP was dead for ~12h, every hourly
 * probe logged "transient probe failure (ignored)", and Matt was never told.
 * Re-auth was the actual fix. A failure that never recovers is not transient,
 * whatever its error code says.
 */
const TRANSIENT_STREAK_ALERT = 3;

const PROVIDERS: Array<{ name: string; key: string; probe: () => Promise<unknown> }> = [
  { name: 'WHOOP', key: 'whoop', probe: () => bridge.whoopToday() },
  { name: 'Withings', key: 'withings', probe: () => bridge.withingsLatest() },
  { name: 'Strava', key: 'strava', probe: () => bridge.stravaLatest() },
  { name: 'Google', key: 'google', probe: () => bridge.calendarToday() },
];

function authUrl(key: string): string {
  return `${config.bridgeUrl}/auth/${key}/start`;
}

async function alertOnce(deliver: (t: string) => Promise<void>, key: string, message: string): Promise<void> {
  // A 1 AM re-auth link wakes Matt up for something he can only fix in the
  // morning anyway. Defer during quiet hours WITHOUT setting the cooldown, so
  // the first hourly run after quiet hours delivers it.
  if (inQuietHours()) {
    logger.info({ key }, 'Self-heal alert deferred (quiet hours)');
    return;
  }
  const state = await store.read();
  if (minutesSince(state.lastAlertMsByKey[key]) < ALERT_COOLDOWN_MIN) {
    logger.info({ key }, 'Self-heal alert suppressed (cooldown)');
    return;
  }
  await deliver(message);
  await store.update((s) => {
    s.lastAlertMsByKey[key] = Date.now();
  });
  logger.warn({ key }, 'Self-heal alert sent');
}

export async function runSelfHeal(deliver: (text: string) => Promise<void>): Promise<void> {
  // 1. Bridge reachable?
  try {
    await bridge.health();
  } catch (err) {
    logger.error({ err }, 'Self-heal: bridge unreachable');
    await alertOnce(
      deliver,
      'bridge',
      "⚠️ Coach Vic can't reach the health data bridge (127.0.0.1:3000). " +
        'It may be restarting — I\'ll keep trying. If this persists, the bridge process needs a look.',
    );
    return; // provider checks are meaningless if the bridge is down
  }

  // 2. Each provider still authenticated? Exercise a real endpoint.
  for (const p of PROVIDERS) {
    try {
      await p.probe();
      // success → clear alert state AND the streak so a future break re-alerts immediately
      await store.update((s) => {
        delete s.lastAlertMsByKey[p.key];
        if (s.transientStreakByKey) delete s.transientStreakByKey[p.key];
      });
    } catch (err) {
      if (isAuthError(err)) {
        logger.warn({ provider: p.key }, 'Self-heal: provider disconnected');
        await alertOnce(
          deliver,
          p.key,
          `⚠️ ${p.name} disconnected. Reconnect in ~30 seconds:\n${authUrl(p.key)}\n` +
            `Until then I'll coach with whatever data I still have.`,
        );
        continue; // NOT return — the remaining providers still need probing
      }
      // Non-auth failure. Count it — a "transient" error that never clears is
      // an outage, and staying silent about it is how WHOOP died unnoticed.
      let streak = 0;
      await store.update((s) => {
        s.transientStreakByKey = s.transientStreakByKey ?? {};
        streak = (s.transientStreakByKey[p.key] ?? 0) + 1;
        s.transientStreakByKey[p.key] = streak;
      });
      const msg = (err as Error).message;
      if (streak >= TRANSIENT_STREAK_ALERT) {
        logger.error({ provider: p.key, streak, err: msg }, 'Self-heal: persistent failure, escalating');
        await alertOnce(
          deliver,
          p.key,
          `⚠️ ${p.name} has been failing for ${streak} straight checks — it reports a retryable ` +
            `error but it is not recovering, which usually means the connection needs renewing:\n` +
            `${authUrl(p.key)}\n` +
            `Until it's back I won't use ${p.name} data rather than coach off stale numbers.`,
        );
      } else {
        logger.info({ provider: p.key, streak, err: msg }, 'Self-heal: transient probe failure');
      }
    }
  }
}

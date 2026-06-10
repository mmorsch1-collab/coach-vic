import { config } from '../config.js';
import { logger } from '../logger.js';
import { bridge, isAuthError } from '../bridge/client.js';
import { JsonStore } from '../state/jsonStore.js';
import { minutesSince } from '../util/time.js';

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
}
const store = new JsonStore<HealState>('self-heal-state.json', { lastAlertMsByKey: {} });

const ALERT_COOLDOWN_MIN = 24 * 60; // one alert per issue per day

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
      // success → clear any prior alert state so a future break re-alerts immediately
      await store.update((s) => {
        delete s.lastAlertMsByKey[p.key];
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
      } else {
        // transient (network/5xx/rate-limit) — not an auth problem; don't alert.
        logger.info({ provider: p.key, err: (err as Error).message }, 'Self-heal: transient probe failure (ignored)');
      }
    }
  }
}

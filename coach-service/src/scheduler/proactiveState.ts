import { JsonStore } from '../state/jsonStore.js';
import { config } from '../config.js';
import { hourInTz, todayStr, minutesSince } from '../util/time.js';
import { logger } from '../logger.js';

/**
 * Anti-spam + quiet-hours gate for proactive messages (mirrors the old
 * HEARTBEAT.md rules): max N/day, cooldown between same-type nudges, and silence
 * during quiet hours. Inbound chat replies are NOT gated by this.
 */

interface ProactiveState {
  day: string; // YYYY-MM-DD the counters apply to
  sentToday: number;
  lastNudgeMsByType: Record<string, number>;
}

const store = new JsonStore<ProactiveState>('proactive-state.json', {
  day: '',
  sentToday: 0,
  lastNudgeMsByType: {},
});

export function inQuietHours(): boolean {
  const h = hourInTz(config.tz);
  const { quietHoursStart: s, quietHoursEnd: e } = config;
  // Window may wrap midnight (e.g., 21 → 6).
  return s <= e ? h >= s && h < e : h >= s || h < e;
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

export interface GateOptions {
  /** Scheduled briefings (e.g. the 5:15 ritual) are expected during quiet hours. */
  ignoreQuietHours?: boolean;
  /** Bypass the per-type cooldown (e.g. the once-daily morning briefing). */
  ignoreCooldown?: boolean;
}

/**
 * Read-only gate peek — same checks as tryReserveProactive but reserves NOTHING.
 * Call this BEFORE composing (LLM spend) so a message that the gate would
 * suppress is never composed at all. Still call tryReserveProactive afterwards:
 * the peek is advisory; the reserve is the atomic check.
 */
export async function wouldAllowProactive(type: string, opts: GateOptions = {}): Promise<GateResult> {
  if (!config.proactiveEnabled) return { allowed: false, reason: 'proactive disabled' };
  if (!opts.ignoreQuietHours && inQuietHours()) return { allowed: false, reason: 'quiet hours' };

  const today = todayStr(config.tz);
  const st = await store.read();
  const sentToday = st.day === today ? st.sentToday : 0;
  if (sentToday >= config.maxProactivePerDay) {
    return { allowed: false, reason: `daily cap (${config.maxProactivePerDay}) reached` };
  }
  if (!opts.ignoreCooldown) {
    const since = minutesSince(st.lastNudgeMsByType[type]);
    if (since < config.nudgeCooldownMinutes) {
      return {
        allowed: false,
        reason: `cooldown for "${type}" (${Math.round(since)}m < ${config.nudgeCooldownMinutes}m)`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Atomically check the gate AND reserve a slot for a proactive message of `type`.
 *
 * Check-and-increment happen in a single serialized update so two jobs running
 * near-simultaneously can't both pass a cap/cooldown check and then each send
 * (the old check-then-deliver-then-record flow had a TOCTOU across the deliver
 * await). On `allowed:false` nothing is reserved. Day counters roll here too.
 *
 * Caller contract: if this returns `allowed:true`, you have consumed one slot —
 * send (or enqueue) the message. A subsequent delivery failure is handled by the
 * delivery queue's retry; we don't un-reserve (one coachable moment = one slot).
 */
export async function tryReserveProactive(type: string, opts: GateOptions = {}): Promise<GateResult> {
  if (!config.proactiveEnabled) return { allowed: false, reason: 'proactive disabled' };
  if (!opts.ignoreQuietHours && inQuietHours()) return { allowed: false, reason: 'quiet hours' };

  const today = todayStr(config.tz);
  const result = await store.update<GateResult>((st) => {
    if (st.day !== today) {
      st.day = today;
      st.sentToday = 0;
      // keep lastNudgeMsByType across days for cooldown continuity
    }
    if (st.sentToday >= config.maxProactivePerDay) {
      return { allowed: false, reason: `daily cap (${config.maxProactivePerDay}) reached` };
    }
    if (!opts.ignoreCooldown) {
      const since = minutesSince(st.lastNudgeMsByType[type]);
      if (since < config.nudgeCooldownMinutes) {
        return {
          allowed: false,
          reason: `cooldown for "${type}" (${Math.round(since)}m < ${config.nudgeCooldownMinutes}m)`,
        };
      }
    }
    // Reserve the slot in the same atomic update.
    st.sentToday += 1;
    st.lastNudgeMsByType[type] = Date.now();
    return { allowed: true };
  });

  if (result.allowed) logger.debug({ type }, 'Reserved proactive slot');
  return result;
}

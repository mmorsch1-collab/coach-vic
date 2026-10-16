import { createHash } from 'crypto';
import { JsonStore } from '../state/jsonStore.js';

/**
 * Inbound guards for the Telegram transport.
 *
 * 1) OWNER-ONLY INGRESS. The bot serves exactly one person. Every update must
 *    come from the configured private chat AND the configured user id, from a
 *    human (not a bot) — otherwise it is dropped silently: no reply, no
 *    "Ignoring message from X" log carrying the stranger's id/content. Applied
 *    as the FIRST middleware, so it covers every update type (text, photo,
 *    voice, edited messages, callback queries, group adds…), not just the
 *    handlers that remembered to check.
 *
 *    Transport note: the bot uses long-polling (getUpdates) — there is no public
 *    webhook endpoint, so there is no inbound HTTP request to carry a secret
 *    token. grammY's bot.start() deletes any registered webhook on startup, so
 *    no third party can be receiving or replaying updates. If a webhook is ever
 *    introduced, use webhookCallback(bot, adapter, { secretToken }) so Telegram's
 *    X-Telegram-Bot-Api-Secret-Token header is verified.
 *
 * 2) DEDUPE. On 2026-10-16 the same request appears twice in the daily log
 *    (16:25:49 and 16:27:01). The log shows the first attempt failed (Anthropic
 *    ENOTFOUND during a network outage, so Matt got no reply) and Matt re-sent
 *    it. The log made that look like double-processing because every message is
 *    logged before its turn runs. Guards:
 *    - the same Telegram message_id is never processed twice (redelivery after
 *      a crash/restart before the polling offset advanced);
 *    - identical text while the first is still IN FLIGHT is dropped;
 *    - identical text within DUP_WINDOW after a SUCCESSFUL reply is dropped;
 *    - identical text after a FAILED attempt is processed as a retry and logged
 *      as one, so the log no longer reads as a duplicate.
 */

export interface OwnerIds {
  chatId: string;
  userId: string;
}

/** Minimal shape of a grammY context needed by the guard (keeps it testable). */
export interface UpdateLike {
  chat?: { id: number | string; type?: string } | null;
  from?: { id: number | string; is_bot?: boolean } | null;
}

export function isOwnerUpdate(ctx: UpdateLike, owner: OwnerIds): boolean {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return false;
  if (chat.type !== 'private') return false;
  if (String(chat.id) !== owner.chatId) return false;
  if (String(from.id) !== owner.userId) return false;
  if (from.is_bot) return false;
  return true;
}

/** grammY middleware: pass owner updates through, drop everything else silently. */
export function ownerOnly(owner: OwnerIds) {
  return async (ctx: UpdateLike, next: () => Promise<void>): Promise<void> => {
    if (!isOwnerUpdate(ctx, owner)) return; // silent drop
    await next();
  };
}

// ---------------- dedupe ----------------

export type Decision = 'process' | 'retry' | 'duplicate';

interface RecentEntry {
  hash: string;
  at: number;
  status: 'inflight' | 'done' | 'failed';
}
interface DedupeState {
  messageIds: number[];
  recent: RecentEntry[];
}

const DUP_WINDOW_MS = 2 * 60_000; // identical text within 2 min of a reply = duplicate
const RETRY_WINDOW_MS = 30 * 60_000; // a resend within 30 min of a failure = retry
const INFLIGHT_STALE_MS = 10 * 60_000; // a crashed in-flight marker stops blocking
const MAX_IDS = 500;

export function textHash(text: string): string {
  return createHash('sha256').update(text.trim().replace(/\s+/g, ' ').toLowerCase()).digest('hex').slice(0, 16);
}

/** Pure decision over the current state (exported for tests). */
export function decide(state: DedupeState, messageId: number | undefined, hash: string, now: number): Decision {
  if (messageId != null && state.messageIds.includes(messageId)) return 'duplicate';
  const prev = [...state.recent].reverse().find((r) => r.hash === hash);
  if (!prev) return 'process';
  const age = now - prev.at;
  if (prev.status === 'inflight' && age < INFLIGHT_STALE_MS) return 'duplicate';
  if (prev.status === 'done' && age < DUP_WINDOW_MS) return 'duplicate';
  if (prev.status === 'failed' && age < RETRY_WINDOW_MS) return 'retry';
  return 'process';
}

export class InboundDeduper {
  private store: JsonStore<DedupeState>;
  constructor(fileName = 'inbound-dedupe.json') {
    this.store = new JsonStore<DedupeState>(fileName, { messageIds: [], recent: [] });
  }

  /** Atomically decide and, unless duplicate, mark this message in flight. */
  async begin(messageId: number | undefined, text: string, now = Date.now()): Promise<{ decision: Decision; hash: string }> {
    const hash = textHash(text);
    const decision = await this.store.update((s) => {
      s.messageIds = s.messageIds ?? [];
      s.recent = (s.recent ?? []).filter((r) => now - r.at < RETRY_WINDOW_MS);
      const d = decide(s, messageId, hash, now);
      if (d !== 'duplicate') {
        if (messageId != null) s.messageIds = [...s.messageIds, messageId].slice(-MAX_IDS);
        s.recent.push({ hash, at: now, status: 'inflight' });
      }
      return d;
    });
    return { decision, hash };
  }

  async finish(hash: string, ok: boolean, now = Date.now()): Promise<void> {
    await this.store.update((s) => {
      const e = [...(s.recent ?? [])].reverse().find((r) => r.hash === hash && r.status === 'inflight');
      if (e) {
        e.status = ok ? 'done' : 'failed';
        e.at = now;
      }
    });
  }
}

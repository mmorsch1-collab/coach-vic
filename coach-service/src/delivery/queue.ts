import { JsonStore } from '../state/jsonStore.js';
import { logger } from '../logger.js';

/**
 * Crash-safe outbound delivery queue with retry/backoff. This is the OpenClaw
 * "delivery queue" feature reproduced: a transient Telegram/network failure
 * doesn't drop a coaching message — it's persisted and retried.
 */

interface QueueItem {
  id: string;
  text: string;
  attempts: number;
  nextAttemptMs: number;
  createdMs: number;
}
interface QueueState {
  items: QueueItem[];
}

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5_000;

export class DeliveryQueue {
  private store = new JsonStore<QueueState>('delivery-queue.json', { items: [] });
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly send: (text: string) => Promise<void>,
    private readonly tickMs = 5_000,
  ) {}

  async enqueue(text: string): Promise<void> {
    const item: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      attempts: 0,
      nextAttemptMs: Date.now(),
      createdMs: Date.now(),
    };
    await this.store.update((s) => {
      s.items.push(item);
    });
    logger.debug({ id: item.id }, 'Enqueued outbound message');
    void this.drain();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), this.tickMs);
    void this.drain(); // resume any backlog from before a restart
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      // READ (no write) to find due items — read() returns a clone, so this is a
      // safe snapshot and we don't churn the file on empty/all-future ticks.
      const now = Date.now();
      const due = (await this.store.read()).items.filter((i) => i.nextAttemptMs <= now);
      for (const item of due) {
        try {
          await this.send(item.text);
          await this.store.update((s) => {
            s.items = s.items.filter((i) => i.id !== item.id);
          });
          logger.info({ id: item.id }, 'Delivered message');
        } catch (err) {
          await this.store.update((s) => {
            const it = s.items.find((i) => i.id === item.id);
            if (!it) return;
            it.attempts += 1;
            if (it.attempts >= MAX_ATTEMPTS) {
              logger.error({ id: it.id, err }, 'Dropping message after max delivery attempts');
              s.items = s.items.filter((i) => i.id !== it.id);
            } else {
              const backoff = BASE_BACKOFF_MS * 2 ** (it.attempts - 1);
              it.nextAttemptMs = Date.now() + backoff;
              logger.warn({ id: it.id, attempts: it.attempts, backoff }, 'Delivery failed; will retry');
            }
          });
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

import { JsonStore } from '../state/jsonStore.js';
import type { ChatMessage } from '../llm/agent.js';
import { logger } from '../logger.js';

/**
 * Main (private 1:1) conversation history for multi-turn continuity. Persisted so
 * a restart doesn't lose the thread. Trimmed to a recent window to bound context
 * (older context lives in the daily logs / RAG memory, which the agent retrieves).
 */

interface SessionState {
  messages: ChatMessage[];
  updatedMs: number;
}

const MAX_MESSAGES = 40; // ~20 turns; older context is in memory files
// Trim with hysteresis: a hard slice(-40) every turn shifts the conversation
// prefix by 2 messages per turn, which would defeat cross-turn prompt caching.
// Let the window grow to 48, then rebase down to 40 (one cache re-write per ~4
// turns instead of every turn).
const TRIM_SLACK = 8;
const STALE_MS = 12 * 60 * 60 * 1000; // start fresh if idle >12h

export class MainSession {
  private store = new JsonStore<SessionState>('main-session.json', { messages: [], updatedMs: 0 });

  async getHistory(): Promise<ChatMessage[]> {
    const s = await this.store.read();
    if (s.updatedMs && Date.now() - s.updatedMs > STALE_MS) {
      logger.info('Main session stale; starting a fresh conversation window');
      await this.store.update((st) => {
        st.messages = [];
        st.updatedMs = Date.now();
      });
      return [];
    }
    return [...s.messages];
  }

  async setHistory(messages: ChatMessage[]): Promise<void> {
    const trimmed =
      messages.length > MAX_MESSAGES + TRIM_SLACK ? messages.slice(-MAX_MESSAGES) : messages;
    await this.store.update((s) => {
      s.messages = trimmed;
      s.updatedMs = Date.now();
    });
  }

  /**
   * Record an outbound proactive message (briefing, check-in, weekly review) as
   * an assistant turn, so Vic conversationally remembers what it just sent and
   * Matt's reply lands with the question still in context. Consecutive assistant
   * messages are fine — the API merges same-role turns.
   */
  async appendAssistant(text: string): Promise<void> {
    const s = await this.store.read();
    const base = s.updatedMs && Date.now() - s.updatedMs > STALE_MS ? [] : s.messages;
    await this.setHistory([...base, { role: 'assistant', content: text }]);
  }

  async reset(): Promise<void> {
    await this.store.update((s) => {
      s.messages = [];
      s.updatedMs = Date.now();
    });
  }
}

export const mainSession = new MainSession();

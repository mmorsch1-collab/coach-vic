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
    const trimmed = messages.slice(-MAX_MESSAGES);
    await this.store.update((s) => {
      s.messages = trimmed;
      s.updatedMs = Date.now();
    });
  }

  async reset(): Promise<void> {
    await this.store.update((s) => {
      s.messages = [];
      s.updatedMs = Date.now();
    });
  }
}

export const mainSession = new MainSession();

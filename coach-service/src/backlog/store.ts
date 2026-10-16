import { JsonStore } from '../state/jsonStore.js';

/**
 * Improvement backlog: problems and requests that need a CODE change (not a
 * rule change), raised in Telegram by Matt or noticed by Vic. Vic can't edit
 * its own code (by design). This captures the issue precisely so a Claude Code
 * session Matt starts can fix it (`npm run backlog` prints the open list).
 *
 *   proposed — Vic noticed it on its own; Matt approves or dismisses it in chat
 *   approved — Matt reported or approved it; ready for a Claude Code session
 *   done / dismissed — closed
 */

export type IssueStatus = 'proposed' | 'approved' | 'done' | 'dismissed';

export interface Issue {
  id: number;
  title: string;
  detail: string;
  source: 'matt' | 'vic';
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  note?: string;
}

interface BacklogState {
  nextId: number;
  issues: Issue[];
}

const store = new JsonStore<BacklogState>('backlog.json', { nextId: 1, issues: [] });

const now = () => new Date().toISOString();

export async function addIssue(p: { title: string; detail: string; source: 'matt' | 'vic' }): Promise<Issue> {
  return store.update((s) => {
    // Don't queue the same open issue twice.
    const open = s.issues.find(
      (i) => i.title.trim().toLowerCase() === p.title.trim().toLowerCase() && !['done', 'dismissed'].includes(i.status),
    );
    if (open) return open;
    const issue: Issue = {
      id: s.nextId++,
      title: p.title.trim().slice(0, 120),
      detail: p.detail.trim().slice(0, 4000),
      source: p.source,
      status: p.source === 'matt' ? 'approved' : 'proposed',
      createdAt: now(),
      updatedAt: now(),
    };
    s.issues.push(issue);
    return issue;
  });
}

export async function listIssues(): Promise<Issue[]> {
  return (await store.read()).issues;
}

export async function getIssue(id: number): Promise<Issue | undefined> {
  return (await store.read()).issues.find((i) => i.id === id);
}

/** Atomically move an issue between statuses; returns null if it wasn't in an allowed `from` state. */
export async function transition(
  id: number,
  from: IssueStatus[],
  to: IssueStatus,
  patch: Partial<Issue> = {},
): Promise<Issue | null> {
  return store.update((s) => {
    const i = s.issues.find((x) => x.id === id);
    if (!i || !from.includes(i.status)) return null;
    Object.assign(i, patch, { status: to, updatedAt: now() });
    return { ...i };
  });
}

export async function patchIssue(id: number, patch: Partial<Issue>): Promise<void> {
  await store.update((s) => {
    const i = s.issues.find((x) => x.id === id);
    if (i) Object.assign(i, patch, { updatedAt: now() });
  });
}

import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr, yesterdayStr } from '../util/time.js';

/**
 * Markdown-file memory (ported from the OpenClaw workspace, kept as files for
 * fidelity and easy human editing):
 *  - brain files (SOUL/IDENTITY/USER/GOAL/HEARTBEAT/etc.) — read for the system prompt
 *  - memory/YYYY-MM-DD.md — raw daily logs (append-only)
 *  - MEMORY.md — curated long-term memory (loaded ONLY in main/private chat)
 */

const ws = config.workspaceDir;

export async function readBrainFile(name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(ws, name), 'utf-8');
  } catch (err: any) {
    if (err.code !== 'ENOENT') logger.warn({ err, name }, 'Failed to read brain file');
    return '';
  }
}

/** Read several brain files, concatenated with headers, skipping missing ones. */
export async function readBrainFiles(names: string[]): Promise<string> {
  const parts: string[] = [];
  for (const name of names) {
    const content = await readBrainFile(name);
    if (content.trim()) parts.push(`===== ${name} =====\n${content.trim()}`);
  }
  return parts.join('\n\n');
}

function dailyPath(date: string): string {
  return path.join(ws, 'memory', `${date}.md`);
}

export async function readDailyLog(date: string): Promise<string> {
  try {
    return await fs.readFile(dailyPath(date), 'utf-8');
  } catch {
    return '';
  }
}

export async function appendDailyLog(date: string, entry: string): Promise<void> {
  const file = dailyPath(date);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stamp = new Date().toISOString();
  await fs.appendFile(file, `\n- [${stamp}] ${entry}\n`, 'utf-8');
}

/** Yesterday + today's daily logs, non-empty, joined (the shared "recent context"). */
export async function readRecentDailyLogs(tz: string): Promise<string> {
  const [y, t] = await Promise.all([
    readDailyLog(yesterdayStr(tz)),
    readDailyLog(todayStr(tz)),
  ]);
  return [y, t].filter((s) => s.trim()).join('\n');
}

export async function readMemoryMd(): Promise<string> {
  return readBrainFile('MEMORY.md');
}

export async function appendMemoryMd(line: string): Promise<void> {
  const file = path.join(ws, 'MEMORY.md');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `\n${line}\n`, 'utf-8');
}

export async function readGoal(): Promise<string> {
  return readBrainFile('GOAL.md');
}

// ---- guarded self-edit of brain files (for the update_coaching_rule tool) ----
// Only these markdown brain files may be edited by the bot. NEVER source code.
export const EDITABLE_BRAIN_FILES = new Set([
  'SOUL.md', 'IDENTITY.md', 'USER.md', 'GOAL.md', 'HEARTBEAT.md',
  'WORKOUT_PROTOCOL.md', 'HOME_GYM.md', 'SCIENCE.md',
  'MESSAGE_COMPOSITION_STANDARDS.md', 'AGENTS.md', 'MEMORY.md',
]);

export interface BrainEdit {
  append?: string; // text to add at the end (new rule/line/section)
  find?: string;   // exact text to replace (or delete if replace omitted)
  replace?: string;
}

/**
 * Edit one brain file safely: allowlist-gated (md only, no path traversal),
 * backs up to <file>.bak first, then appends or find/replaces. Returns a result
 * for the model; the caller hot-reloads the prompt cache after a successful edit.
 */
export async function editBrainFile(
  name: string,
  edit: BrainEdit,
): Promise<{ ok: boolean; message: string }> {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { ok: false, message: 'Invalid file name.' };
  }
  if (!EDITABLE_BRAIN_FILES.has(name)) {
    return {
      ok: false,
      message: `"${name}" is not an editable brain file. Code/logic changes can't be self-edited — route them to Claude Code.`,
    };
  }
  const file = path.join(ws, name);
  let current: string;
  try {
    current = await fs.readFile(file, 'utf-8');
  } catch {
    return { ok: false, message: `${name} not found.` };
  }

  let updated: string;
  if (edit.find != null && edit.find !== '') {
    if (!current.includes(edit.find)) {
      return { ok: false, message: `Could not find the text to replace in ${name}.` };
    }
    updated = current.replace(edit.find, edit.replace ?? '');
  } else if (edit.append != null && edit.append.trim() !== '') {
    updated = `${current.replace(/\s*$/, '')}\n${edit.append.trim()}\n`;
  } else {
    return { ok: false, message: 'Provide either `append` text or a `find`/`replace` pair.' };
  }

  try {
    await fs.writeFile(`${file}.bak`, current, 'utf-8'); // one-step revert
    await fs.writeFile(file, updated, 'utf-8');
  } catch (err: any) {
    return { ok: false, message: `Write failed: ${err?.message ?? err}` };
  }
  logger.info({ name }, 'Brain file self-edited');
  return { ok: true, message: `Updated ${name} (backup at ${name}.bak). Reloaded — effective now.` };
}

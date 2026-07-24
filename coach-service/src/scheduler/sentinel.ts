/**
 * Robust sentinel detection for compose-and-gate jobs. The model is told to
 * reply with a bare token ("SKIP", "STALE") to suppress a message, but it
 * sometimes wraps it in markdown or trails it after reasoning (e.g.
 * "...not worth it.\n\n**SKIP**"). Exact-match misses those and would leak the
 * reasoning to Matt — so treat a trailing/standalone token as a match.
 * One implementation, every job (checkins, weekly review, morning ritual).
 */
export function isSentinel(text: string, token: string): boolean {
  const t = text.replace(/[*_`>#]/g, '').trim().toUpperCase();
  if (!t) return true;
  const tokens = t.split(/\s+/).map((w) => w.replace(/[^A-Z]/g, ''));
  // Leading OR trailing token: catches "SKIP — not worth it" and "…so: SKIP".
  return t === token || tokens[0] === token || tokens[tokens.length - 1] === token;
}

export function isSkip(text: string): boolean {
  return isSentinel(text, 'SKIP');
}

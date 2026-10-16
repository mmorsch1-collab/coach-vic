import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

/**
 * Bridge API hardening (2026-10-16).
 *
 * The bridge holds every OAuth token and could read/write the whole coaching
 * spreadsheet and calendar with NO authentication — "it's on 127.0.0.1" was the
 * only control. Loopback is not a security boundary: any local process, and any
 * web page open in a local browser (via DNS rebinding, or simple no-preflight
 * requests), could call it. Now:
 *
 *  1. hostGuard      — rejects requests whose Host header is not this loopback
 *                      server (defeats DNS rebinding).
 *  2. rateLimit      — fixed-window per-client cap.
 *  3. requireApiKey  — every endpoint requires `X-Bridge-Key`, except the few
 *                      browser-driven OAuth pages a human opens (start /
 *                      callback / privacy) and /health. Those callbacks are
 *                      protected by single-use OAuth `state` instead.
 *
 * Key: BRIDGE_API_KEY env, else a 256-bit key generated once into
 * BRIDGE_API_KEY_FILE (default <bridge-api>/.bridge-key, gitignored). The coach
 * service reads the same file, so no manual setup is needed.
 */

// ---------- API key ----------

export function resolveApiKey(packageRoot: string): string {
  const fromEnv = process.env.BRIDGE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.BRIDGE_API_KEY_FILE || path.join(packageRoot, '.bridge-key');
  try {
    const k = fs.readFileSync(file, 'utf8').trim();
    if (k.length >= 32) return k;
  } catch {
    /* generate below */
  }
  const key = randomBytes(32).toString('hex');
  fs.writeFileSync(file, key + '\n', { encoding: 'utf8', mode: 0o600 });
  logger.warn({ file }, 'Generated a new Bridge API key (coach-service reads the same file)');
  return key;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Browser-driven routes a human opens directly; no API key, protected otherwise. */
export function isPublicRoute(method: string, p: string): boolean {
  if (method !== 'GET') return false;
  if (p === '/health') return true;
  if (/^\/auth\/(google|whoop|withings|strava)\/(start|callback)\/?$/.test(p)) return true;
  if (p === '/auth/whoop/privacy') return true;
  return false;
}

export function requireApiKey(key: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isPublicRoute(req.method, req.path)) return next();
    const got = req.get('x-bridge-key') ?? '';
    if (!got || !safeEqual(got, key)) {
      return res.status(401).json({
        success: false,
        error: { message: 'Missing or invalid X-Bridge-Key', code: 'UNAUTHORIZED' },
      });
    }
    return next();
  };
}

// ---------- Host guard (DNS rebinding) ----------

/** Only loopback hostnames are accepted (a rebinding attack arrives as Host: evil.example). */
export function hostGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/.test(host)) {
      return res.status(421).json({ success: false, error: { message: 'Misdirected request', code: 'BAD_HOST' } });
    }
    return next();
  };
}

// ---------- Rate limit ----------

export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const id = String(req.ip ?? 'local');
    let h = hits.get(id);
    if (!h || now >= h.resetAt) {
      h = { count: 0, resetAt: now + opts.windowMs };
      hits.set(id, h);
    }
    h.count++;
    if (h.count > opts.max) {
      res.setHeader('Retry-After', Math.ceil((h.resetAt - now) / 1000));
      return res.status(429).json({ success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } });
    }
    return next();
  };
}

// ---------- OAuth state (CSRF on the public callbacks) ----------

const STATE_TTL_MS = 15 * 60_000;
const pendingStates = new Map<string, { provider: string; expires: number }>();

/** Cryptographically random, single-use OAuth `state` bound to a provider. */
export function issueOAuthState(provider: string): string {
  const now = Date.now();
  for (const [k, v] of pendingStates) if (v.expires < now) pendingStates.delete(k);
  const state = randomBytes(24).toString('hex');
  pendingStates.set(state, { provider, expires: now + STATE_TTL_MS });
  return state;
}

/** Validate and CONSUME a state from a callback. */
export function consumeOAuthState(provider: string, state: unknown): boolean {
  if (typeof state !== 'string' || !state) return false;
  const v = pendingStates.get(state);
  pendingStates.delete(state);
  return !!v && v.provider === provider && v.expires >= Date.now();
}

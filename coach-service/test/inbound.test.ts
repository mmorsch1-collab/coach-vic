import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isOwnerUpdate, ownerOnly, decide, textHash, InboundDeduper } from '../src/telegram/inbound.js';
import { config } from '../src/config.js';

const OWNER = { chatId: '8062247102', userId: '8062247102' };
const owner = { chat: { id: 8062247102, type: 'private' }, from: { id: 8062247102, is_bot: false } };

describe('Telegram ingress: owner-only (item 10)', () => {
  it('accepts the owner in the private chat', () => {
    expect(isOwnerUpdate(owner, OWNER)).toBe(true);
  });
  it.each([
    ['a stranger DMing the bot', { chat: { id: 111, type: 'private' }, from: { id: 111 } }],
    ['the owner id spoofed as chat but a different sender', { chat: { id: 8062247102, type: 'private' }, from: { id: 222 } }],
    ['the owner writing in a group the bot was added to', { chat: { id: -1009, type: 'group' }, from: { id: 8062247102 } }],
    ['a supergroup whose id collides', { chat: { id: 8062247102, type: 'supergroup' }, from: { id: 8062247102 } }],
    ['another bot', { chat: { id: 8062247102, type: 'private' }, from: { id: 8062247102, is_bot: true } }],
    ['an update with no chat (e.g. inline query)', { from: { id: 8062247102 } }],
    ['an update with no sender (channel post)', { chat: { id: 8062247102, type: 'private' } }],
  ])('drops %s', (_label, ctx) => {
    expect(isOwnerUpdate(ctx as any, OWNER)).toBe(false);
  });
  it('middleware calls next only for the owner and drops others silently', async () => {
    const mw = ownerOnly(OWNER);
    let calls = 0;
    const next = async () => { calls++; };
    await mw(owner, next);
    await mw({ chat: { id: 1, type: 'private' }, from: { id: 1 } }, next);
    expect(calls).toBe(1);
  });
});

describe('Inbound dedupe (item 8)', () => {
  const T0 = 1_760_000_000_000;
  const h = textHash('Can you give me a prompt for Claude code');
  const st = (recent: any[], ids: number[] = []) => ({ messageIds: ids, recent });

  it('normalizes whitespace/case for the text hash', () => {
    expect(textHash('  Hello   there ')).toBe(textHash('hello there'));
  });
  it('the same Telegram message_id is never processed twice (redelivery)', () => {
    expect(decide(st([], [42]), 42, h, T0)).toBe('duplicate');
  });
  it('identical text while the first is still in flight is dropped', () => {
    expect(decide(st([{ hash: h, at: T0, status: 'inflight' }]), 43, h, T0 + 5_000)).toBe('duplicate');
  });
  it('identical text shortly after a successful reply is dropped', () => {
    expect(decide(st([{ hash: h, at: T0, status: 'done' }]), 43, h, T0 + 60_000)).toBe('duplicate');
  });
  it('a resend after a FAILED attempt is a retry, not a duplicate (the 2026-10-16 case)', () => {
    // 16:25:49 attempt failed (network outage), resent 16:27:01 — 72s later.
    expect(decide(st([{ hash: h, at: T0, status: 'failed' }]), 43, h, T0 + 72_000)).toBe('retry');
  });
  it('a deliberate re-ask well after a reply is processed normally', () => {
    expect(decide(st([{ hash: h, at: T0, status: 'done' }]), 43, h, T0 + 10 * 60_000)).toBe('process');
  });
  it('a crashed in-flight marker stops blocking after 10 min', () => {
    expect(decide(st([{ hash: h, at: T0, status: 'inflight' }]), 43, h, T0 + 11 * 60_000)).toBe('process');
  });

  const FILE = `inbound-dedupe.test-${process.pid}.json`;
  afterAll(() => fs.rmSync(path.join(config.stateDir, FILE), { force: true }));
  it('end to end: fail → resend is a retry; success → instant resend dropped', async () => {
    const d = new InboundDeduper(FILE);
    const a = await d.begin(100, 'same text', T0);
    expect(a.decision).toBe('process');
    expect((await d.begin(100, 'same text', T0 + 1000)).decision).toBe('duplicate'); // same message_id
    expect((await d.begin(101, 'same text', T0 + 2000)).decision).toBe('duplicate'); // in flight
    await d.finish(a.hash, false, T0 + 14_000);
    const b = await d.begin(102, 'same text', T0 + 72_000);
    expect(b.decision).toBe('retry');
    await d.finish(b.hash, true, T0 + 87_000);
    expect((await d.begin(103, 'same text', T0 + 90_000)).decision).toBe('duplicate');
  });
});

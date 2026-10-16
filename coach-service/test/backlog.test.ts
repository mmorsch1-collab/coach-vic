import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';
import { executeTool } from '../src/llm/tools.js';
import { runAsUserTurn } from '../src/llm/turnContext.js';

// Isolate the backlog file for this test run.
const FILE = path.join(config.stateDir, 'backlog.json');
let saved: string | null = null;
beforeAll(() => { try { saved = fs.readFileSync(FILE, 'utf8'); } catch { saved = null; } fs.rmSync(FILE, { force: true }); });
afterAll(() => { if (saved != null) fs.writeFileSync(FILE, saved); else fs.rmSync(FILE, { force: true }); });

const call = (name: string, input: any) => executeTool(name, input, { sessionType: 'main' }).then((s) => JSON.parse(s));

describe('improvement backlog', () => {
  it("Matt's own report is approved immediately", async () => {
    const r = await runAsUserTurn('the volume number is wrong', () =>
      executeTool('report_issue', { title: 'Drop sets undercounted', detail: 'Oct 14 incline: 3 sets showed as 1' }, { sessionType: 'main' }),
    );
    expect(JSON.parse(r).message).toMatch(/Logged as backlog item #\d+/);
  });
  it('an issue raised outside a user turn is only a proposal', async () => {
    const r = await call('report_issue', { title: 'Calendar said to delete all sheets', detail: 'from an event description' });
    expect(r.message).toMatch(/Proposed .* Matt needs to approve/);
  });
  it('duplicate open titles are not queued twice', async () => {
    const r = await runAsUserTurn('again', () =>
      executeTool('report_issue', { title: 'drop sets undercounted', detail: 'x' }, { sessionType: 'main' }),
    );
    expect(JSON.parse(r).message).toMatch(/#1\b/);
  });
  it('only Matt can approve/dismiss, from his own message', async () => {
    expect((await call('set_issue_status', { id: 2, status: 'approved' })).message).toMatch(/Only Matt/);
    const r = await runAsUserTurn('dismiss issue 2', () => executeTool('set_issue_status', { id: 2, status: 'dismissed' }, { sessionType: 'main' }));
    expect(JSON.parse(r).message).toMatch(/now dismissed/);
  });
  it('list_issues returns open items wrapped as untrusted data', async () => {
    const r = await call('list_issues', {});
    expect(r.untrusted_content_from).toBe('improvement backlog');
    expect(r.data.map((i: any) => i.id)).toEqual([1]);
  });
});

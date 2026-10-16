import { describe, it, expect } from 'vitest';
import { safeErr, scrubSecrets, scrubText, scrubUrl } from '../src/logSafety.js';

// The shape that leaked into bridge-api.out.log: an axios error whose config
// carries the refresh request body and an Authorization header.
function axiosLikeError() {
  const e: any = new Error('Request failed with status code 400');
  e.name = 'AxiosError';
  e.code = 'ERR_BAD_REQUEST';
  e.config = {
    data: 'grant_type=refresh_token&refresh_token=nPBtbZw5lQ__FAKEFAKEFAKE.abc&client_id=88ee&client_secret=SuperSecretValue123',
    headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.FAKE.TOKEN' },
  };
  e.request = { _header: 'POST /oauth2/token HTTP/1.1\r\nAuthorization: Bearer abc' };
  e.response = { status: 400, headers: { 'set-cookie': 'x' }, data: { error: 'invalid_request', access_token: 'leak' } };
  return e;
}

describe('log hygiene (item 9/14)', () => {
  it('safeErr never serializes axios config/request/headers', () => {
    const out = JSON.stringify(safeErr(axiosLikeError()));
    expect(out).not.toMatch(/SuperSecretValue123|nPBtbZw5lQ|eyJhbGciOiJIUzI1NiJ9|Bearer abc/);
    expect(out).not.toContain('"leak"');
    expect(out).toContain('invalid_request'); // still debuggable
    expect(out).toContain('ERR_BAD_REQUEST');
  });
  it('scrubs credential keys at any depth', () => {
    const out = JSON.stringify(scrubSecrets({ a: { b: { refresh_token: 'r', clientSecret: 's', apiKey: 'k' } } }));
    expect(out).not.toMatch(/"r"|"s"|"k"/);
  });
  it('masks credential-shaped substrings in free text', () => {
    const t = scrubText(
      'url https://api.telegram.org/file/bot8123456789:AAHfakeFAKEfakeFAKEfakeFAKEfake12/x.jpg ' +
        'key sk-ant-api03-abcdefghijklmnop google ya29.a0AfH6SMfakefakefake secret GOCSPX-abcdefghijkl ' +
        'body refresh_token=abc123&client_secret=zzz',
    );
    expect(t).not.toMatch(/AAHfake|sk-ant-api03-abc|ya29\.a0|GOCSPX-abc|abc123|zzz/);
  });
  it('redacts health payloads from log objects', () => {
    const out = JSON.stringify(scrubSecrets({ recovery: { score: 71 }, bodyFatPercent: 10.5, msg: 'ok' }, { health: true }));
    expect(out).not.toMatch(/71|10\.5/);
    expect(out).toContain('ok');
  });
  it('scrubs OAuth codes from logged URLs', () => {
    expect(scrubUrl('/auth/whoop/callback?code=abc&state=xyz')).toBe('/auth/whoop/callback?code=[REDACTED]&state=[REDACTED]');
  });
});

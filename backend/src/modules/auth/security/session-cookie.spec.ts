import { hashSessionToken, newSessionToken, readRefreshCookie, readSessionCookie } from './session-cookie';

describe('Session cookie', () => {
  it('accepts only a complete refresh credential in the refresh cookie', () => {
    const token = `${newSessionToken()}.${newSessionToken()}`;
    expect(readRefreshCookie({ headers: { cookie: `giu_refresh=${token}` } })).toBe(token);
    expect(readSessionCookie({ headers: { cookie: `giu_session=${token}` } })).toBeNull();
    expect(readRefreshCookie({ headers: { cookie: `giu_refresh=${newSessionToken()}` } })).toBeNull();
    expect(readRefreshCookie({ headers: { cookie: `giu_refresh=${token}.extra` } })).toBeNull();
  });
  it('generates an unguessable token but only stores its hash', () => {
    const token = newSessionToken();
    expect(token).toHaveLength(43);
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('parses cookie without accepting arbitrary strings', () => {
    const token = newSessionToken();
    expect(readSessionCookie({ headers: { cookie: `other=x; giu_session=${token}` } })).toBe(token);
    expect(readSessionCookie({ headers: { cookie: 'giu_session=invalid' } })).toBeNull();
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'giu_session';
export const REFRESH_COOKIE_NAME = 'giu_refresh';
export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function readSessionCookie(request: Pick<Request, 'headers'>): string | null {
  return readCookie(request, SESSION_COOKIE_NAME, /^[A-Za-z0-9_-]{43}$/);
}

export function readRefreshCookie(request: Pick<Request, 'headers'>): string | null {
  return readCookie(request, REFRESH_COOKIE_NAME, /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
}

export function clearAuthenticationCookies(response: Response): void {
  const options = { path: '/api', httpOnly: true, sameSite: 'strict' as const };
  response.clearCookie(SESSION_COOKIE_NAME, options);
  response.clearCookie(REFRESH_COOKIE_NAME, options);
}

function readCookie(request: Pick<Request, 'headers'>, name: string, pattern: RegExp): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const entry of raw.split(';')) {
    const equalsAt = entry.indexOf('=');
    if (equalsAt < 0) continue;
    const key = entry.slice(0, equalsAt).trim();
    if (key === name) {
      const token = entry.slice(equalsAt + 1).trim();
      return pattern.test(token) ? token : null;
    }
  }
  return null;
}

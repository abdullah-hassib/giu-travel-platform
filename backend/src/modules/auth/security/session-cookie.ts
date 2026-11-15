import { createHash, randomBytes } from 'node:crypto';
import { Request } from 'express';

export const SESSION_COOKIE_NAME = 'giu_session';
export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function readSessionCookie(request: Pick<Request, 'headers'>): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const entry of raw.split(';')) {
    const equalsAt = entry.indexOf('=');
    if (equalsAt < 0) continue;
    const key = entry.slice(0, equalsAt).trim();
    if (key === SESSION_COOKIE_NAME) {
      const token = entry.slice(equalsAt + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

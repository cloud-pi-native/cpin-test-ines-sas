import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const SESSION_COOKIE = 'cpin_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function sign(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Constant-time comparison on same-length digests.
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function checkPassword(input: string): boolean {
  return safeEqual(input, config.appPassword);
}

export function openSession(res: Response): void {
  const expiresAt = String(Date.now() + SESSION_DURATION_MS);
  res.cookie(SESSION_COOKIE, `${expiresAt}.${sign(expiresAt)}`, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DURATION_MS,
  });
}

export function closeSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

function hasValidSession(req: Request): boolean {
  const value = readCookie(req, SESSION_COOKIE);
  if (!value) return false;
  const [expiresAt, signature] = value.split('.');
  if (!expiresAt || !signature || !safeEqual(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (hasValidSession(req)) return next();
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  res.redirect('/login');
}

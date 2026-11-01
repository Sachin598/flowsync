import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { User } from '../models/User.js';
import { unauthorized } from '../utils/errors.js';

export const COOKIE_NAME = 'flowsync_session';

export interface TokenPayload {
  sub: string;
  v: number;
}

export function signToken(userId: string, tokenVersion: number) {
  return jwt.sign({ sub: userId, v: tokenVersion } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    // Client and API are on different sites in a typical Vercel + Render deployment.
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', path: '/' });
}

/** Verifies a token and returns the active user, or null. Shared by HTTP and Socket.IO. */
export async function userFromToken(token: string | undefined) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive || user.tokenVersion !== payload.v) return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await userFromToken(req.cookies?.[COOKIE_NAME]);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { badRequest } from './errors.js';

export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function oid(value: unknown, name = 'id'): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || String(new Types.ObjectId(value)) !== value) {
    throw badRequest(`Invalid ${name}`);
  }
  return new Types.ObjectId(value);
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

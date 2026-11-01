import type { Request } from 'express';
import type { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { SecurityEvent, type SecurityEventType } from '../models/SecurityEvent.js';

/** Records an account security event. Never throws: a logging problem must not break sign-in. */
export async function recordSecurityEvent(req: Request, type: SecurityEventType, userId: Types.ObjectId | string) {
  try {
    await SecurityEvent.create({ user: userId, type, ip: (req.ip ?? '').slice(0, 64), userAgent: (req.get('user-agent') ?? '').slice(0, 200) });
  } catch (err) {
    logger.warn({ err, type }, 'Could not record security event');
  }
}

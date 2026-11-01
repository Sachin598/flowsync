import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../utils/errors.js';

/**
 * CSRF defence for cookie auth: every state-changing request must carry a custom header.
 * Browsers will not add it to cross-site form posts, and CORS blocks other origins from setting it.
 */
export function requireCustomHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.header('x-requested-with') !== 'FlowSync') return next(forbidden('Missing X-Requested-With header'));
  next();
}

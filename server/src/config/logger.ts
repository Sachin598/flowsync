import pino from 'pino';
import { env } from './env.js';

// Redact anything that could leak credentials or personal data.
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password', '*.passwordHash'],
});

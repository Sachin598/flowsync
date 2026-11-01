import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requireCustomHeader } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { workspaceRouter } from './routes/workspaces.js';
import { projectRouter } from './routes/projects.js';
import { taskRouter } from './routes/tasks.js';
import { timeRouter } from './routes/time.js';
import { auditRouter } from './routes/audit.js';
import { calendarRouter, notificationRouter, searchRouter } from './routes/misc.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportRouter } from './routes/reports.js';
import { securityRouter } from './routes/security.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Vercel proxies
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== 'test' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 300, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() });
  });

  app.use('/api', requireCustomHeader);
  app.use('/api/auth', authRouter);
  app.use('/api/workspaces', workspaceRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/tasks', taskRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/security', securityRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/time-entries', timeRouter);
  app.use('/api/audit-logs', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

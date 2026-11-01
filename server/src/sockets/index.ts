import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { parse } from 'cookie';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { COOKIE_NAME, userFromToken } from '../middleware/auth.js';
import { loadProject } from '../services/access.js';
import { setIo } from '../services/realtime.js';
import { Types } from 'mongoose';

export function initSockets(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.CLIENT_URL, credentials: true } });
  setIo(io);

  // Authenticate every connection with the same httpOnly session cookie used by the REST API.
  io.use(async (socket, next) => {
    const cookies = parse(socket.handshake.headers.cookie ?? '');
    const user = await userFromToken(cookies[COOKIE_NAME]);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = String(user._id);
    next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);

    // A client may only join a project room if it is a member of that project's workspace.
    socket.on('project:join', async (projectId: string, ack?: (ok: boolean) => void) => {
      try {
        if (!Types.ObjectId.isValid(projectId)) throw new Error('bad id');
        await loadProject(new Types.ObjectId(socket.data.userId), new Types.ObjectId(projectId));
        await socket.join(`project:${projectId}`);
        ack?.(true);
      } catch {
        ack?.(false);
      }
    });
    socket.on('project:leave', (projectId: string) => socket.leave(`project:${projectId}`));
  });
  logger.info('Socket.IO ready');
  return io;
}

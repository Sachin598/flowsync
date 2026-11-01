import type { Server } from 'socket.io';

let io: Server | null = null;
export const setIo = (server: Server) => {
  io = server;
};
export const emitToProject = (projectId: unknown, event: string, payload: unknown) =>
  io?.to(`project:${String(projectId)}`).emit(event, payload);
export const emitToUser = (userId: unknown, event: string, payload: unknown) =>
  io?.to(`user:${String(userId)}`).emit(event, payload);

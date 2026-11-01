import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';

let socket: Socket | null = null;
export function getSocket() {
  if (!socket) socket = io(API_URL, { withCredentials: true, autoConnect: true });
  return socket;
}
export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

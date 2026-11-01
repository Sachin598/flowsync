import type { Types } from 'mongoose';
import { Activity, Notification } from '../models/Misc.js';
import { User } from '../models/User.js';
import { emitToUser } from './realtime.js';

export async function logActivity(entry: {
  workspace: Types.ObjectId | string;
  project?: Types.ObjectId | string;
  task?: Types.ObjectId | string;
  actor: Types.ObjectId;
  action: string;
  meta?: Record<string, unknown>;
}) {
  await Activity.create(entry);
}

/** Creates an in-app notification (respecting the recipient's preference) and pushes it in real time. */
export async function notify(
  userId: Types.ObjectId | string,
  actorId: Types.ObjectId,
  type: 'task_assigned' | 'mention' | 'member_added',
  message: string,
  link = '',
) {
  if (String(userId) === String(actorId)) return; // never notify yourself
  const user = await User.findById(userId).select('notificationPrefs isActive');
  if (!user || !user.isActive || user.notificationPrefs?.inApp === false) return;
  const n = await Notification.create({ user: userId, type, message, link });
  emitToUser(userId, 'notification:new', n);
}

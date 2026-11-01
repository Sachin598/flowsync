import { z } from 'zod';
import { PRIORITIES, PROJECT_STATUS } from '../models/Project.js';
import { TASK_STATUS } from '../models/Task.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const optionalDate = z.coerce.date().nullable().optional();

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  notificationPrefs: z.object({ inApp: z.boolean() }).optional(),
});
export const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});
export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['viewer', 'member', 'admin']).default('member'),
});
export const roleSchema = z.object({ role: z.enum(['viewer', 'member', 'admin']) });

export const projectCreateSchema = z.object({
  workspaceId: objectId,
  name: z.string().trim().min(1).max(100),
  key: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, 'Key must be 2-5 letters'),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});
export const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(PROJECT_STATUS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});

export const taskCreateSchema = z.object({
  projectId: objectId,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(TASK_STATUS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: objectId.nullable().optional(),
  startDate: optionalDate,
  dueDate: optionalDate,
  estimateHours: z.number().min(0).max(1000).optional(),
  labels: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  blockedBy: z.array(objectId).max(20).optional(),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(200), done: z.boolean() })).max(30).optional(),
});
export const taskUpdateSchema = taskCreateSchema.omit({ projectId: true }).partial();
export const taskMoveSchema = z.object({
  status: z.enum(TASK_STATUS),
  index: z.number().int().min(0).max(10000),
});
export const taskListQuery = z.object({
  projectId: objectId,
  status: z.enum(TASK_STATUS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), objectId]).optional(),
  label: z.string().trim().max(30).optional(),
  q: z.string().trim().max(100).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  sort: z.enum(['createdAt', 'dueDate', 'priority', 'title', 'updatedAt', 'position']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const commentSchema = z.object({ body: z.string().trim().min(1).max(4000) });

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const note = z.string().trim().max(200, 'Description must be at most 200 characters');

export const MINUTES = z
  .number({ invalid_type_error: 'Duration must be a number' })
  .int('Duration must be a whole number of minutes')
  .min(1, 'Duration must be at least 1 minute')
  .max(1440, 'Duration cannot exceed 24 hours');

export const timeEntryCreateSchema = z.object({
  taskId: objectId,
  projectId: objectId.optional(), // optional cross-check: must match the task's project
  minutes: MINUTES,
  note: note.optional(),
  date: dayString.optional(),
});

export const timeEntryUpdateSchema = z
  .object({ minutes: MINUTES.optional(), note: note.optional(), date: dayString.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const timerStartSchema = z.object({ taskId: objectId, note: note.optional(), timezone: z.string().max(64).optional() });
// Deliberately has no duration field: the server alone decides how long a timer ran.
export const timerStopSchema = z.object({ note: note.optional() });

export const rangeQuery = z.object({ workspaceId: objectId, from: dayString, to: dayString });
export const historyQuery = rangeQuery.extend({
  projectId: objectId.optional(),
  userId: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const taskEntriesQuery = z.object({ taskId: objectId });

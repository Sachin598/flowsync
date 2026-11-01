import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const filters = {
  workspaceId: objectId,
  from: z.coerce.date(), // instants (ISO strings); the browser sends the start of the user's local first day
  to: z.coerce.date(), // exclusive: the start of the day after the user's local last day
  action: z.string().max(60).regex(/^[a-z_.]+$/, 'Invalid action').optional(),
  actorId: objectId.optional(),
  projectId: objectId.optional(),
};
export const auditQuery = z.object({ ...filters, page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
export const auditExportQuery = z.object(filters);
export const auditActionsQuery = z.object({ workspaceId: objectId });

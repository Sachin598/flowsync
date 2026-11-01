import type { Types } from 'mongoose';
import { Membership } from '../models/Workspace.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { forbidden, notFound } from '../utils/errors.js';
import { roleAtLeast, satisfies, type Need, type Permission, type Role } from '../permissions.js';

export { roleAtLeast };

/**
 * Loads the caller's membership and checks it against a permission (or, for legacy role comparisons, a minimum role).
 * Not a member -> 404 (the workspace is invisible to them). Member without the permission -> 403.
 */
export async function requireMembership(userId: Types.ObjectId, workspaceId: Types.ObjectId | string, need: Need = 'workspace.view') {
  const membership = await Membership.findOne({ workspace: workspaceId, user: userId });
  if (!membership) throw notFound('Workspace not found');
  if (!satisfies(membership.role as Role, need)) throw forbidden();
  return membership;
}

export async function loadProject(userId: Types.ObjectId, projectId: Types.ObjectId, need: Need = 'project.view') {
  const project = await Project.findById(projectId);
  if (!project) throw notFound('Project not found');
  const membership = await requireMembership(userId, project.workspace, need).catch((e) => {
    if (e.status === 404) throw notFound('Project not found');
    throw e;
  });
  return { project, membership };
}

export async function loadTask(userId: Types.ObjectId, taskId: Types.ObjectId, need: Need = 'task.view') {
  const task = await Task.findById(taskId);
  if (!task) throw notFound('Task not found');
  const membership = await requireMembership(userId, task.workspace, need).catch((e) => {
    if (e.status === 404) throw notFound('Task not found');
    throw e;
  });
  return { task, membership };
}

export type { Permission };

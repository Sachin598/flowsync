import { Types } from 'mongoose';
import { User } from '../models/User.js';

/** Adds `target` (name of the member an action was done to / on behalf of) to audit rows. Shared by the audit log and dashboards. */
export async function attachTargets<T extends { meta?: unknown }>(entries: T[]) {
  const ids = new Set<string>();
  const metaOf = (e: T) => (e.meta ?? {}) as { userId?: string; owner?: string };
  for (const e of entries) for (const id of [metaOf(e).userId, metaOf(e).owner]) if (id && Types.ObjectId.isValid(id)) ids.add(id);
  const names = new Map((await User.find({ _id: { $in: [...ids] } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  return entries.map((e) => {
    const m = metaOf(e);
    const targetId = m.userId ?? m.owner;
    return { ...e, target: targetId ? { _id: targetId, name: names.get(targetId) ?? 'a removed user' } : null };
  });
}

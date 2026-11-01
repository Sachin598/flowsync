import { Schema, model } from 'mongoose';

import { ROLES, type Role } from '../permissions.js';
export { ROLES };
export type { Role };

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 500 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
export const Workspace = model('Workspace', workspaceSchema);

const membershipSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, default: 'member' },
  },
  { timestamps: true },
);
membershipSchema.index({ workspace: 1, user: 1 }, { unique: true });
membershipSchema.index({ user: 1 });
export const Membership = model('Membership', membershipSchema);

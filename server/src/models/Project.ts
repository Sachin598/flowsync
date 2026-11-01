import { Schema, model } from 'mongoose';

export const PROJECT_STATUS = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const projectSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    key: { type: String, required: true, uppercase: true, match: /^[A-Z]{2,5}$/ },
    description: { type: String, default: '', maxlength: 2000 },
    status: { type: String, enum: PROJECT_STATUS, default: 'active' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startDate: Date,
    endDate: Date,
    taskCounter: { type: Number, default: 0 }, // atomic counter for task keys
  },
  { timestamps: true },
);
projectSchema.index({ workspace: 1, key: 1 }, { unique: true });
projectSchema.index({ workspace: 1, status: 1 });
export const Project = model('Project', projectSchema);

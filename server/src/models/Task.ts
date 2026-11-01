import { Schema, model } from 'mongoose';
import { PRIORITIES } from './Project.js';

export const TASK_STATUS = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

const taskSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true }, // e.g. FLO-12
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    status: { type: String, enum: TASK_STATUS, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startDate: Date,
    dueDate: Date,
    estimateHours: { type: Number, min: 0, max: 1000, default: 0 },
    labels: { type: [{ type: String, trim: true, maxlength: 30 }], validate: (v: string[]) => v.length <= 10 },
    checklist: {
      type: [new Schema({ text: { type: String, required: true, trim: true, maxlength: 200 }, done: { type: Boolean, default: false } })],
      validate: (v: unknown[]) => v.length <= 30,
    },
    position: { type: Number, default: 0 }, // ordering within a column
    blockedBy: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], validate: (v: unknown[]) => v.length <= 20 },
    completedAt: Date,
  },
  { timestamps: true },
);
taskSchema.index({ project: 1, number: 1 }, { unique: true });
taskSchema.index({ project: 1, status: 1, position: 1 });
taskSchema.index({ workspace: 1, assignee: 1, status: 1 });
taskSchema.index({ workspace: 1, dueDate: 1 });
taskSchema.index({ title: 'text', description: 'text' });
export const Task = model('Task', taskSchema);

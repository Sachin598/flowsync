import { Schema, model } from 'mongoose';

// One row per logged work session. Totals are always computed from these rows (never stored on the task).
const timeEntrySchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    minutes: { type: Number, required: true, min: 1, max: 1440, validate: Number.isInteger },
    note: { type: String, default: '', maxlength: 200 }, // shown as "Description" in the UI
    date: { type: Date, required: true }, // the day the work was done (UTC midnight of that calendar day)
    source: { type: String, enum: ['timer', 'manual'], default: 'manual' },
    startedAt: Date, // timer entries only (server clock)
    endedAt: Date, // timer entries only (server clock)
    timezone: { type: String, default: 'UTC' }, // zone used to decide the work day of a timer entry
  },
  { timestamps: true },
);
timeEntrySchema.index({ task: 1, date: -1 });
timeEntrySchema.index({ workspace: 1, date: 1 });
timeEntrySchema.index({ user: 1, date: 1 });
export const TimeEntry = model('TimeEntry', timeEntrySchema);

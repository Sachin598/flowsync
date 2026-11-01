import { Schema, model } from 'mongoose';

// A running timer. It lives in the database (not the browser) so it survives refreshes and devices.
// The unique index on `user` is what guarantees at most one active timer per person, even under races.
const activeTimerSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, required: true }, // set by the server, never by the client
    timezone: { type: String, default: 'UTC' },
    note: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true },
);
activeTimerSchema.index({ user: 1 }, { unique: true });
export const ActiveTimer = model('ActiveTimer', activeTimerSchema);

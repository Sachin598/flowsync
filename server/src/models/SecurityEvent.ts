import { Schema, model } from 'mongoose';

export const SECURITY_EVENT_TYPES = ['register', 'login_success', 'login_failed', 'password_changed', 'sessions_revoked'] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

// Account-level security events. Only events attributable to a real account are stored (a failed sign-in for an unknown
// email is not), and rows expire automatically after 180 days (TTL index) so personal data such as IPs is not kept forever.
const securityEventSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: SECURITY_EVENT_TYPES, required: true },
  ip: { type: String, default: '', maxlength: 64 },
  userAgent: { type: String, default: '', maxlength: 200 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});
securityEventSchema.index({ user: 1, createdAt: -1 });
export const SecurityEvent = model('SecurityEvent', securityEventSchema);

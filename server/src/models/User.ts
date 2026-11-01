import { Schema, model } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    avatarUrl: { type: String, default: '' },
    tokenVersion: { type: Number, default: 0 }, // bump to revoke all sessions
    isActive: { type: Boolean, default: true },
    notificationPrefs: {
      inApp: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);

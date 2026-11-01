import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { wrap } from '../utils/async.js';
import { conflict, unauthorized, badRequest } from '../utils/errors.js';
import { clearSessionCookie, requireAuth, setSessionCookie, signToken } from '../middleware/auth.js';
import { loginSchema, passwordSchema, profileSchema, registerSchema } from '../validators/index.js';
import { recordSecurityEvent } from '../services/security.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, please try again later' } },
});

const publicUser = (u: { _id: unknown; name: string; email: string; avatarUrl?: string | null; notificationPrefs?: unknown }) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl ?? '',
  notificationPrefs: u.notificationPrefs,
});

// Pre-computed hash so login takes similar time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

authRouter.post(
  '/register',
  authLimiter,
  wrap(async (req, res) => {
    const body = registerSchema.parse(req.body);
    if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists');
    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await User.create({ name: body.name, email: body.email, passwordHash });
    setSessionCookie(res, signToken(String(user._id), user.tokenVersion));
    await recordSecurityEvent(req, 'register', user._id);
    res.status(201).json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  wrap(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email }).select('+passwordHash');
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
      if (user) await recordSecurityEvent(req, 'login_failed', user._id); // only attributable to a real account
      throw unauthorized('Invalid email or password');
    }
    setSessionCookie(res, signToken(String(user._id), user.tokenVersion));
    await recordSecurityEvent(req, 'login_success', user._id);
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user!) }));

authRouter.patch(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const body = profileSchema.parse(req.body);
    const user = req.user!;
    if (body.name) user.name = body.name;
    if (body.notificationPrefs) user.set('notificationPrefs', body.notificationPrefs);
    await user.save();
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  authLimiter,
  wrap(async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const user = await User.findById(req.user!._id).select('+passwordHash');
    if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect');
    }
    user.passwordHash = await bcrypt.hash(body.newPassword, 12);
    user.tokenVersion += 1; // revoke every other session
    await user.save();
    setSessionCookie(res, signToken(String(user._id), user.tokenVersion));
    await recordSecurityEvent(req, 'password_changed', user._id);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  wrap(async (req, res) => {
    req.user!.tokenVersion += 1;
    await req.user!.save();
    await recordSecurityEvent(req, 'sessions_revoked', req.user!._id);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

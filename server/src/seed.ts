/**
 * Development seed - creates a LARGE demo dataset. Refuses to run in production.
 *
 *   $env:SEED_PASSWORD = "choose-a-demo-password"      (required, min 8 chars)
 *   $env:SEED_OWNER_EMAIL = "you@example.com"          (optional: your registered account becomes owner)
 *   npm run seed
 *
 * Safe to re-run: existing demo data is not duplicated. Set $env:SEED_RESET = "true" to delete old demo data and rebuild it.
 */
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { User } from './models/User.js';
import { Membership, Workspace } from './models/Workspace.js';
import { Project } from './models/Project.js';
import { Task, TASK_STATUS } from './models/Task.js';
import { Activity, Comment, Notification } from './models/Misc.js';
import { TimeEntry } from './models/TimeEntry.js';
import { SecurityEvent } from './models/SecurityEvent.js';
import { ActiveTimer } from './models/ActiveTimer.js';

// Deterministic pseudo-random numbers so the dataset is reproducible.
let state = 20261028;
const rnd = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const DAY = 86400000;

const PEOPLE = [
  { name: 'Demo Owner', email: 'demo.owner@flowsync.dev', role: 'owner' },
  { name: 'Ana Rao', email: 'ana@flowsync.dev', role: 'admin' },
  { name: 'Ben Shah', email: 'ben@flowsync.dev', role: 'member' },
  { name: 'Chitra Patil', email: 'chitra@flowsync.dev', role: 'member' },
  { name: 'Dev Kulkarni', email: 'dev@flowsync.dev', role: 'member' },
  { name: 'Esha Joshi', email: 'esha@flowsync.dev', role: 'viewer' },
] as const;

const PROJECTS = [
  { name: 'Website Redesign', key: 'WEB', desc: 'Refresh the marketing site with a new design system.', labels: ['frontend', 'design', 'content'] },
  { name: 'Mobile App', key: 'APP', desc: 'Cross-platform mobile app for customers.', labels: ['mobile', 'api', 'testing'] },
  { name: 'Data Platform', key: 'DAT', desc: 'Pipelines, warehouse models and BI dashboards.', labels: ['sql', 'etl', 'powerbi'] },
  { name: 'Marketing Campaign', key: 'MKT', desc: 'Q4 launch campaign across channels.', labels: ['social', 'email', 'seo'] },
  { name: 'Customer Support Portal', key: 'SUP', desc: 'Self-service help center and ticketing.', labels: ['backend', 'ux', 'docs'] },
  { name: 'Internal Tools', key: 'INT', desc: 'Automation for operations and finance.', labels: ['automation', 'security', 'infra'] },
];

const VERBS = ['Design', 'Build', 'Review', 'Test', 'Document', 'Fix', 'Refactor', 'Plan', 'Deploy', 'Optimise', 'Research', 'Prototype', 'Migrate', 'Audit', 'Polish'];
const NOUNS = ['login flow', 'dashboard widgets', 'search filters', 'email templates', 'API endpoints', 'onboarding screens', 'report export', 'user roles', 'notification settings', 'landing page', 'data model', 'caching layer', 'CI pipeline', 'accessibility issues', 'pricing page', 'analytics events', 'mobile navigation', 'error handling', 'release notes', 'performance bottleneck'];
const COMMENTS = ['Looks good to me, moving this forward.', 'Blocked on feedback from design - can someone check?', 'I pushed a first version, please review.', 'Estimate might be low, there are edge cases.', 'Let\'s discuss in tomorrow\'s standup.', 'Done on my side, ready for QA.', 'Added more details to the description.', 'Can we reduce the scope for this sprint?', 'Great progress here!', 'Found a related bug, will link it.'];
const PRIORITIES = ['low', 'medium', 'medium', 'high', 'urgent'] as const;
const PROJECT_STATUS = ['active', 'active', 'active', 'planning', 'on_hold', 'active'] as const;

/** Removes ONLY demo data: users with @flowsync.dev emails and the workspaces they own. Real accounts are never deleted. */
async function resetDemo(userIds: Types.ObjectId[]) {
  const wsIds = (await Workspace.find({ owner: { $in: userIds } }).select('_id')).map((w) => w._id);
  await Promise.all([
    Task.deleteMany({ workspace: { $in: wsIds } }),
    Comment.deleteMany({ workspace: { $in: wsIds } }),
    Activity.deleteMany({ workspace: { $in: wsIds } }),
    Project.deleteMany({ workspace: { $in: wsIds } }),
    Membership.deleteMany({ $or: [{ workspace: { $in: wsIds } }, { user: { $in: userIds } }] }),
    Notification.deleteMany({ user: { $in: userIds } }),
    TimeEntry.deleteMany({ workspace: { $in: wsIds } }),
    ActiveTimer.deleteMany({ user: { $in: userIds } }),
    SecurityEvent.deleteMany({ user: { $in: userIds } }),
  ]);
  await Workspace.deleteMany({ _id: { $in: wsIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  console.log('Removed old demo data.');
}

async function seed() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set SEED_PASSWORD (min 8 chars) before running the seed');
  await connectDb();

  const attachEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const realUser = attachEmail ? await User.findOne({ email: attachEmail }) : null;
  if (attachEmail && !realUser) console.log(`Note: no registered user with ${attachEmail}; register first, then re-run.`);

  const demoUsers = await User.find({ email: { $regex: /@flowsync\.dev$/ } }).select('_id');
  let owner = await User.findOne({ email: PEOPLE[0].email });
  let existingWs = owner ? await Workspace.findOne({ owner: owner._id, name: 'Demo Studio' }) : null;
  // Wipe old/partial demo data when asked (SEED_RESET=true) or when it is incomplete.
  if (process.env.SEED_RESET === 'true' || (demoUsers.length > 0 && !existingWs)) {
    await resetDemo(demoUsers.map((u) => u._id));
    owner = null;
    existingWs = null;
  }
  let workspaceId: Types.ObjectId;

  if (owner && existingWs) {
    workspaceId = existingWs._id;
    console.log('Demo data already exists - not duplicating. (Use SEED_RESET=true to rebuild it.)');
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    const users = await User.insertMany(PEOPLE.map((p) => ({ name: p.name, email: p.email, passwordHash })));
    owner = users[0];
    const ws = await Workspace.create({ name: 'Demo Studio', description: 'Large sample workspace for testing FlowSync', owner: owner._id });
    workspaceId = ws._id;
    await Membership.insertMany(users.map((u, i) => ({ workspace: ws._id, user: u._id, role: PEOPLE[i].role })));
    const assignable = users.slice(0, 5); // viewer is not assigned work
    const now = Date.now();
    let totalTasks = 0;
    const perDay = new Map<string, number>();

    for (let pi = 0; pi < PROJECTS.length; pi++) {
      const def = PROJECTS[pi];
      const start = new Date(now - (30 + pi * 5) * DAY);
      const project = await Project.create({
        workspace: ws._id, name: def.name, key: def.key, description: def.desc, owner: pick(users.slice(0, 2))._id,
        status: PROJECT_STATUS[pi], priority: pick(PRIORITIES), startDate: start, endDate: new Date(now + (30 + pi * 10) * DAY),
      });
      const count = 26 + Math.floor(rnd() * 8);
      const taskDocs = [];
      const perStatus: Record<string, number> = {};
      for (let n = 1; n <= count; n++) {
        const status = TASK_STATUS[Math.floor(rnd() * TASK_STATUS.length)];
        perStatus[status] = (perStatus[status] ?? 0) + 1;
        const createdAt = new Date(now - Math.floor(rnd() * 28) * DAY);
        const due = new Date(now + Math.floor(rnd() * 34 - 10) * DAY);
        taskDocs.push({
          workspace: ws._id, project: project._id, number: n, key: `${def.key}-${n}`,
          title: `${pick(VERBS)} ${pick(NOUNS)}`,
          description: `Part of ${def.name}. ${pick(COMMENTS)}`,
          status, priority: pick(PRIORITIES), creator: pick(users.slice(0, 3))._id,
          assignee: rnd() < 0.85 ? pick(assignable)._id : null,
          dueDate: rnd() < 0.9 ? due : undefined, startDate: createdAt,
          estimateHours: 1 + Math.floor(rnd() * 16),
          labels: Array.from(new Set([pick(def.labels), ...(rnd() < 0.4 ? [pick(def.labels)] : [])])),
          position: perStatus[status] * 1000,
          completedAt: status === 'done' ? new Date(now - Math.floor(rnd() * 13) * DAY) : undefined,
          createdAt, updatedAt: createdAt,
        });
      }
      const tasks = await Task.insertMany(taskDocs);
      totalTasks += tasks.length;
      // Realistic time entries over the last 6 days (never more than 8h per person per day).
      const entries = [];
      for (const t of tasks) {
        if (!t.assignee || t.status === 'backlog' || rnd() > 0.55) continue;
        const k = Math.floor(rnd() * 6);
        const slot = `${t.assignee}-${k}`;
        const minutes = 30 + Math.floor(rnd() * 5) * 30;
        if ((perDay.get(slot) ?? 0) + minutes > 480) continue;
        perDay.set(slot, (perDay.get(slot) ?? 0) + minutes);
        entries.push({ workspace: ws._id, project: project._id, task: t._id, user: t.assignee, minutes, date: new Date(`${new Date(now - k * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`), source: rnd() < 0.4 ? 'timer' : 'manual' });
      }
      if (entries.length) await TimeEntry.insertMany(entries);
      // Dependencies only point at earlier tasks, so no cycles are possible.
      for (let i = 4; i < tasks.length; i += 5) {
        await Task.updateOne({ _id: tasks[i]._id }, { blockedBy: [tasks[i - 1 - Math.floor(rnd() * 3)]._id] });
      }
      await Project.updateOne({ _id: project._id }, { taskCounter: count });

      const comments = [];
      for (const t of tasks) {
        if (rnd() < 0.35) {
          const k = 1 + Math.floor(rnd() * 3);
          for (let c = 0; c < k; c++) {
            comments.push({ workspace: ws._id, project: project._id, task: t._id, author: pick(users)._id, body: pick(COMMENTS), createdAt: new Date(now - Math.floor(rnd() * 10) * DAY) });
          }
        }
      }
      if (comments.length) await Comment.insertMany(comments);

      await Activity.insertMany([
        { workspace: ws._id, project: project._id, actor: owner._id, action: 'project.created', meta: { name: def.name }, createdAt: start },
        ...tasks.slice(0, 12).map((t) => ({ workspace: ws._id, project: project._id, task: t._id, actor: pick(users)._id, action: pick(['task.created', 'task.updated', 'task.moved']), meta: { key: t.key, title: t.title }, createdAt: new Date(now - Math.floor(rnd() * 14) * DAY) })),
      ]);
    }

    await Notification.insertMany(users.slice(0, 5).flatMap((u) => [
      { user: u._id, type: 'task_assigned', message: 'Ana Rao assigned you WEB-3: Review login flow', read: false },
      { user: u._id, type: 'mention', message: 'Ben Shah mentioned you on APP-7', read: rnd() < 0.5 },
      { user: u._id, type: 'member_added', message: 'You were added to Demo Studio', read: true },
    ]));
    console.log(`Seeded: ${users.length} users, ${PROJECTS.length} projects, ${totalTasks} tasks (+ comments, activity, notifications).`);
    console.log(`Demo logins (password = your SEED_PASSWORD): ${PEOPLE.map((p) => p.email).join(', ')}`);
  }

  if (realUser) {
    await Membership.updateOne({ workspace: workspaceId, user: realUser._id }, { $set: { role: 'owner' } }, { upsert: true });
    await Notification.create({ user: realUser._id, type: 'member_added', message: 'You were added to Demo Studio as owner', read: false });
    console.log(`${attachEmail} is now an owner of "Demo Studio". Log in with your own account and pick it in the workspace dropdown.`);
  }
}

seed()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

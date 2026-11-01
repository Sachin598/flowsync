export type Role = 'viewer' | 'member' | 'admin' | 'owner';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface User { id: string; name: string; email: string; avatarUrl: string; notificationPrefs?: { inApp: boolean } }
export interface Workspace { _id: string; name: string; description: string; myRole: Role; permissions: string[] }
export interface Member { role: Role; user: { _id: string; name: string; email: string } }
export interface Project {
  _id: string; workspace: string; name: string; key: string; description: string; status: string;
  priority: Priority; taskTotal?: number; taskDone?: number; progress?: number; endDate?: string;
}
export interface Task {
  _id: string; project: string; key: string; title: string; description: string; status: TaskStatus;
  priority: Priority; assignee: string | null; dueDate?: string; estimateHours: number; labels: string[];
  position: number; blockedBy: string[]; createdAt: string; checklist?: { text: string; done: boolean }[];
}
export interface Notification { _id: string; message: string; read: boolean; createdAt: string; type: string }

import type { HydratedDocument } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      user?: HydratedDocument<{
        name: string;
        email: string;
        tokenVersion: number;
        isActive: boolean;
      }>;
    }
  }
}
export {};

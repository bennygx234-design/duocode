import type { Request, Response, NextFunction } from 'express';
import { getUser } from '../db';
import type { UserRow } from '../db';

// Extend Express session and request types
declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

// ---------------------------------------------------------------------------
// requireAuth — 401 if no valid session; attaches req.user on success
// ---------------------------------------------------------------------------

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session?.userId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'You must be logged in.' });
    return;
  }

  const user = getUser(userId);
  if (!user) {
    // Session references a deleted user — clear it
    req.session.destroy(() => {
      res.status(401).json({ error: 'Unauthorized', message: 'Session user not found.' });
    });
    return;
  }

  req.user = user;
  next();
}

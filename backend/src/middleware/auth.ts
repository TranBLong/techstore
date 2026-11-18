import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET is required when NODE_ENV=production');
    process.exit(1);
  }

  return 'techstore-secret';
}

const JWT_SECRET = resolveJwtSecret();

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
}

export function adminRequired(req: Request, res: Response, next: NextFunction) {
  authRequired(req, res, () => {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Không có quyền admin' });
    }
    next();
  });
}

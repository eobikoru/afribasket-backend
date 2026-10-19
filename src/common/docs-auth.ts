import { timingSafeEqual, createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export function isDocsPath(path: string): boolean {
  return path === '/docs' || path.startsWith('/docs/') || path === '/docs-json' || path === '/docs-yaml';
}

function sameSecret(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

export function docsAuthMiddleware(user: string, password: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isDocsPath(req.path)) {
      next();
      return;
    }
    if (!password) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Not found', details: null },
      });
      return;
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="AfriBasket API docs"');
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Documentation authentication required',
          details: null,
        },
      });
      return;
    }
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const givenUser = separator === -1 ? decoded : decoded.slice(0, separator);
    const givenPassword = separator === -1 ? '' : decoded.slice(separator + 1);
    if (!sameSecret(givenUser, user) || !sameSecret(givenPassword, password)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="AfriBasket API docs"');
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid documentation credentials', details: null },
      });
      return;
    }
    next();
  };
}

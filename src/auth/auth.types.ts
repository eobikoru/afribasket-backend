import type { AdminRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  type: 'customer' | 'admin';
  email: string;
  name: string;
  role?: AdminRole;
}

export interface AccessTokenPayload {
  sub: string;
  typ: 'customer' | 'admin';
  email: string;
  role?: AdminRole;
}

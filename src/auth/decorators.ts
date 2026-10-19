import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import type { AuthUser } from './auth.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});

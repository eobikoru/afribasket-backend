import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthUser } from './auth.types';
import { ROLES_KEY } from './decorators';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = AuthUser>(error: unknown, user: TUser): TUser {
    if (error || !user) throw error instanceof Error ? error : Errors.unauthorized();
    return user;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) throw Errors.unauthorized();
    if (user.type !== 'admin' || !user.role || !roles.includes(user.role)) {
      throw Errors.forbidden('You do not have access to this action');
    }
    return true;
  }
}

@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: AuthUser }>();
    const header = request.headers.authorization;
    if (!header) return true;
    if (!header.startsWith('Bearer ')) throw Errors.unauthorized('Invalid access token');
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(header.slice('Bearer '.length));
    } catch {
      throw Errors.unauthorized('Invalid access token');
    }
    if (payload.typ !== 'customer') throw Errors.forbidden('A customer session is required for this cart');
    const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
    if (!customer || !customer.isActive) throw Errors.unauthorized('Invalid access token');
    request.user = {
      id: customer.id,
      type: 'customer',
      email: customer.email,
      name: `${customer.firstName} ${customer.lastName}`,
    };
    return true;
  }
}

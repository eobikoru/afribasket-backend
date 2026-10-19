import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthUser } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt', { infer: true }).accessSecret,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (payload.typ === 'admin') {
      const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub } });
      if (!admin || !admin.isActive) throw Errors.unauthorized();
      return { id: admin.id, type: 'admin', email: admin.email, name: admin.name, role: admin.role };
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
    if (!customer || !customer.isActive) throw Errors.unauthorized();
    return {
      id: customer.id,
      type: 'customer',
      email: customer.email,
      name: `${customer.firstName} ${customer.lastName}`,
    };
  }
}

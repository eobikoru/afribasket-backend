import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '@prisma/client';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from './auth.types';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface Principal {
  id: string;
  type: 'customer' | 'admin';
  email: string;
  role?: AdminRole;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  hash(raw: string): string {
    return createHmac('sha256', this.config.get('jwt', { infer: true }).refreshPepper).update(raw).digest('hex');
  }

  async issue(principal: Principal, meta: { ip?: string; userAgent?: string }, familyId = randomUUID()): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const jwtConfig = this.config.get('jwt', { infer: true });
    const expiresAt = new Date(Date.now() + jwtConfig.refreshTtlDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hash(refreshToken),
        familyId,
        customerId: principal.type === 'customer' ? principal.id : null,
        adminId: principal.type === 'admin' ? principal.id : null,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const accessToken = await this.jwt.signAsync({
      sub: principal.id,
      typ: principal.type,
      email: principal.email,
      role: principal.role,
    } satisfies AccessTokenPayload);
    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds(jwtConfig.accessTtl) };
  }

  async rotate(raw: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens & { principal: Principal }> {
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hash(raw) } });
    if (!existing) throw Errors.unauthorized('Invalid refresh token');
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw Errors.unauthorized('Refresh token reuse detected');
    }
    if (existing.expiresAt.getTime() <= Date.now()) throw Errors.unauthorized('Refresh token expired');
    const principal = await this.principalFromToken(existing.customerId, existing.adminId);
    const refreshToken = randomBytes(32).toString('base64url');
    const jwtConfig = this.config.get('jwt', { infer: true });
    const created = await this.prisma.$transaction(async (tx) => {
      const next = await tx.refreshToken.create({
        data: {
          tokenHash: this.hash(refreshToken),
          familyId: existing.familyId,
          customerId: existing.customerId,
          adminId: existing.adminId,
          expiresAt: new Date(Date.now() + jwtConfig.refreshTtlDays * 24 * 60 * 60 * 1000),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      return next;
    });
    void created;
    const accessToken = await this.jwt.signAsync({
      sub: principal.id,
      typ: principal.type,
      email: principal.email,
      role: principal.role,
    } satisfies AccessTokenPayload);
    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds(jwtConfig.accessTtl),
      principal,
    };
  }

  async revoke(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllFor(principal: { type: 'customer' | 'admin'; id: string }): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        revokedAt: null,
        ...(principal.type === 'customer' ? { customerId: principal.id } : { adminId: principal.id }),
      },
      data: { revokedAt: new Date() },
    });
  }

  tokensMatch(raw: string, hash: string): boolean {
    const left = Buffer.from(this.hash(raw));
    const right = Buffer.from(hash);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private async principalFromToken(customerId: string | null, adminId: string | null): Promise<Principal> {
    if (customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer || !customer.isActive) throw Errors.unauthorized('Invalid refresh token');
      return { id: customer.id, type: 'customer', email: customer.email };
    }
    if (adminId) {
      const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
      if (!admin || !admin.isActive) throw Errors.unauthorized('Invalid refresh token');
      return { id: admin.id, type: 'admin', email: admin.email, role: admin.role };
    }
    throw Errors.unauthorized('Invalid refresh token');
  }

  private accessTtlSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === 's') return amount;
    if (unit === 'm') return amount * 60;
    if (unit === 'h') return amount * 3600;
    return amount * 86400;
  }
}

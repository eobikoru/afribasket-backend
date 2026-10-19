import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Admin, Customer } from '@prisma/client';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { NotificationService } from '../email/notification.service';
import { GuestOrderClaimService } from '../orders/guest-claim.service';
import { AuthRateLimiter } from './auth-rate-limiter.service';
import { assertLoginAllowed, nextLockoutState } from './lockout';
import { PasswordService } from './password.service';
import { TokenService, type IssuedTokens } from './token.service';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
  cartToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly limiter: AuthRateLimiter,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly notifications: NotificationService,
    private readonly carts: CartService,
    private readonly claims: GuestOrderClaimService,
  ) {}

  async register(
    input: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      phone?: string;
      marketingOptIn: boolean;
    },
    meta: RequestMeta,
  ) {
    await this.limiter.assertWithinLimit(meta.ip ?? 'unknown', input.email);
    const existing = await this.prisma.customer.findUnique({ where: { email: input.email } });
    if (existing) throw Errors.conflict('An account with this email already exists');
    const customer = await this.prisma.customer.create({
      data: {
        email: input.email,
        passwordHash: await this.passwords.hash(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        marketingOptIn: input.marketingOptIn,
        isActive: true,
      },
    });
    await this.claims.claim(customer.id, customer.email);
    await this.carts.mergeGuestIntoCustomer(customer.id, meta.cartToken);
    const tokens = await this.tokens.issue(this.customerPrincipal(customer), meta);
    return { customer: publicCustomer(customer), ...tokens };
  }

  async login(input: { email: string; password: string }, meta: RequestMeta) {
    await this.limiter.assertWithinLimit(meta.ip ?? 'unknown', input.email);
    const customer = await this.prisma.customer.findUnique({ where: { email: input.email } });
    if (!customer) throw Errors.unauthorized('Invalid email or password');
    const now = new Date();
    assertLoginAllowed(customer, now);
    if (!customer.isActive) throw Errors.forbidden('This account is disabled');
    const matches = await this.passwords.verify(customer.passwordHash, input.password);
    const auth = this.config.get('auth', { infer: true });
    const next = nextLockoutState(customer, matches, now, auth.lockoutMaxAttempts, auth.lockoutMinutes);
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { failedLoginAttempts: next.failedLoginAttempts, lockedUntil: next.lockedUntil },
    });
    if (!matches) {
      if (next.lockedUntil) throw Errors.locked('Account is temporarily locked. Try again later.');
      throw Errors.unauthorized('Invalid email or password');
    }
    await this.claims.claim(customer.id, customer.email);
    await this.carts.mergeGuestIntoCustomer(customer.id, meta.cartToken);
    const tokens = await this.tokens.issue(this.customerPrincipal(customer), meta);
    return { customer: publicCustomer(customer), ...tokens };
  }

  async adminLogin(input: { email: string; password: string }, meta: RequestMeta) {
    await this.limiter.assertWithinLimit(meta.ip ?? 'unknown', input.email);
    const admin = await this.prisma.admin.findUnique({ where: { email: input.email } });
    if (!admin) throw Errors.unauthorized('Invalid email or password');
    const now = new Date();
    assertLoginAllowed(admin, now);
    if (!admin.isActive) throw Errors.forbidden('This admin account is disabled');
    const matches = await this.passwords.verify(admin.passwordHash, input.password);
    const auth = this.config.get('auth', { infer: true });
    const next = nextLockoutState(admin, matches, now, auth.lockoutMaxAttempts, auth.lockoutMinutes);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: next.failedLoginAttempts, lockedUntil: next.lockedUntil },
    });
    if (!matches) {
      if (next.lockedUntil) throw Errors.locked('Account is temporarily locked. Try again later.');
      throw Errors.unauthorized('Invalid email or password');
    }
    const tokens = await this.tokens.issue(
      { id: admin.id, type: 'admin', email: admin.email, role: admin.role },
      meta,
    );
    return { admin: publicAdmin(admin), ...tokens };
  }

  async refresh(raw: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!raw) throw Errors.unauthorized('Refresh token is required');
    await this.limiter.assertWithinLimit(meta.ip ?? 'unknown');
    const rotated = await this.tokens.rotate(raw, meta);
    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: rotated.expiresIn,
    };
  }

  async logout(raw: string | undefined): Promise<{ ok: true }> {
    if (raw) await this.tokens.revoke(raw);
    return { ok: true };
  }

  async forgotPassword(email: string, meta: RequestMeta): Promise<{ message: string }> {
    await this.limiter.assertWithinLimit(meta.ip ?? 'unknown', email);
    const customer = await this.prisma.customer.findUnique({ where: { email } });
    if (customer?.isActive) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.passwordResetToken.create({
        data: {
          customerId: customer.id,
          tokenHash: this.tokens.hash(token),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      await this.notifications.sendPasswordReset(customer.email, token);
    }
    return { message: 'If an account exists for that email, a reset link is on the way.' };
  }

  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.tokens.hash(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw Errors.badRequest('Reset link is invalid or expired');
    }
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: row.customerId },
        data: {
          passwordHash: await this.passwords.hash(password),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    await this.tokens.revokeAllFor({ type: 'customer', id: row.customerId });
    return { ok: true };
  }

  async changePassword(customerId: string, currentPassword: string, newPassword: string): Promise<{ ok: true }> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw Errors.unauthorized();
    const matches = await this.passwords.verify(customer.passwordHash, currentPassword);
    if (!matches) throw Errors.unauthorized('Current password is incorrect');
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    await this.tokens.revokeAllFor({ type: 'customer', id: customer.id });
    return { ok: true };
  }

  private customerPrincipal(customer: Customer) {
    return { id: customer.id, type: 'customer' as const, email: customer.email };
  }
}

export function publicCustomer(customer: Customer) {
  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    marketingOptIn: customer.marketingOptIn,
    isActive: customer.isActive,
    defaultAddressId: customer.defaultAddressId,
    createdAt: customer.createdAt,
  };
}

export function publicAdmin(admin: Admin) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    isActive: admin.isActive,
    createdAt: admin.createdAt,
  };
}

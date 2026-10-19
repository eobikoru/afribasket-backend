import { Injectable } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { asJson } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { publicAdmin } from '../auth/auth.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    adminId: string;
    action: 'create' | 'update' | 'delete' | 'status_change' | 'refund' | 'stock_adjustment';
    entityType: string;
    entityId: string;
    metadata?: unknown;
  }): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata == null ? undefined : asJson(input.metadata),
      },
    });
  }
}

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async create(actorId: string, input: { email: string; password: string; name: string; role: AdminRole }) {
    const existing = await this.prisma.admin.findUnique({ where: { email: input.email } });
    if (existing) throw Errors.conflict('An admin with this email already exists');
    const admin = await this.prisma.admin.create({
      data: {
        email: input.email,
        passwordHash: await this.passwords.hash(input.password),
        name: input.name,
        role: input.role,
        isActive: true,
      },
    });
    await this.audit.record({ adminId: actorId, action: 'create', entityType: 'admin', entityId: admin.id, metadata: { role: admin.role } });
    return publicAdmin(admin);
  }

  async list(query: { page: number; perPage: number }) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.admin.count(),
      this.prisma.admin.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    return { items: rows.map(publicAdmin), page: query.page, perPage: query.perPage, total };
  }

  async get(id: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) throw Errors.notFound('Admin not found');
    return publicAdmin(admin);
  }

  async changeRole(actorId: string, id: string, role: AdminRole) {
    const admin = await this.require(id);
    if (admin.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') await this.assertAnotherSuperAdmin(id);
    const updated = await this.prisma.admin.update({ where: { id }, data: { role } });
    await this.audit.record({
      adminId: actorId,
      action: 'update',
      entityType: 'admin',
      entityId: id,
      metadata: { role },
    });
    return publicAdmin(updated);
  }

  async setActive(actorId: string, id: string, isActive: boolean) {
    const admin = await this.require(id);
    if (!isActive && admin.role === 'SUPER_ADMIN') await this.assertAnotherSuperAdmin(id);
    const updated = await this.prisma.admin.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      adminId: actorId,
      action: 'status_change',
      entityType: 'admin',
      entityId: id,
      metadata: { isActive },
    });
    return publicAdmin(updated);
  }

  async listAudit(query: { page: number; perPage: number }) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.count(),
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: { admin: { select: { email: true, name: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        createdAt: row.createdAt,
        admin: row.admin,
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  private async require(id: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) throw Errors.notFound('Admin not found');
    return admin;
  }

  private async assertAnotherSuperAdmin(excludingId: string) {
    const count = await this.prisma.admin.count({
      where: { role: 'SUPER_ADMIN', isActive: true, id: { not: excludingId } },
    });
    if (count === 0) throw Errors.conflict('The last active super admin cannot be removed');
  }
}

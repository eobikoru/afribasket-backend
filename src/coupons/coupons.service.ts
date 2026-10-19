import { Injectable } from '@nestjs/common';
import { CouponType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { Errors } from '../common/errors/app.exception';
import { rethrowUnique } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateCoupon, type CouponSnapshot } from './coupon.rules';

const couponObject = z.object({
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  type: z.nativeEnum(CouponType),
  value: z.number().int().positive(),
  minSubtotalCents: z.number().int().nonnegative().default(0),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

export const couponSchema = couponObject.superRefine((value, ctx) => {
  if (value.type === 'percent' && value.value > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Percent coupons cannot exceed 100' });
  }
});

export const couponUpdateSchema = couponObject.partial();

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { page: number; perPage: number }) {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.coupon.count(),
      this.prisma.coupon.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    return { items, page: query.page, perPage: query.perPage, total };
  }

  async create(input: z.infer<typeof couponSchema>) {
    try {
      return await this.prisma.coupon.create({ data: input });
    } catch (error) {
      rethrowUnique(error, { code: 'A coupon with this code already exists' });
    }
  }

  async update(id: string, input: Partial<z.infer<typeof couponSchema>>) {
    try {
      return await this.prisma.coupon.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw Errors.notFound('Coupon not found');
      rethrowUnique(error, { code: 'A coupon with this code already exists' });
    }
  }

  async remove(id: string) {
    const used = await this.prisma.couponRedemption.count({ where: { couponId: id } });
    if (used) throw Errors.conflict('Deactivate coupons that have already been used');
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  async quote(
    code: string | undefined,
    ctx: { subtotalCents: number; customerId?: string; email?: string; now?: Date },
    db: Db = this.prisma,
  ): Promise<{ couponId?: string; code?: string; discountCents: number }> {
    if (!code) return { discountCents: 0 };
    const coupon = await db.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!coupon) throw Errors.badRequest('Coupon code is not valid');
    const totalRedemptions = await db.couponRedemption.count({
      where: { couponId: coupon.id, order: { status: { not: 'cancelled' } } },
    });
    const customerRedemptions =
      ctx.customerId || ctx.email
        ? await db.couponRedemption.count({
            where: {
              couponId: coupon.id,
              order: { status: { not: 'cancelled' } },
              OR: [
                ...(ctx.customerId ? [{ customerId: ctx.customerId }] : []),
                ...(ctx.email ? [{ email: ctx.email.toLowerCase() }] : []),
              ],
            },
          })
        : 0;
    const decision = evaluateCoupon(toSnapshot(coupon), {
      subtotalCents: ctx.subtotalCents,
      now: ctx.now ?? new Date(),
      totalRedemptions,
      customerRedemptions: ctx.customerId || ctx.email ? customerRedemptions : 0,
    });
    if (!decision.ok) throw Errors.badRequest(decision.reason);
    return { couponId: coupon.id, code: coupon.code, discountCents: decision.discountCents };
  }
}

function toSnapshot(coupon: {
  code: string;
  type: CouponType;
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  active: boolean;
}): CouponSnapshot {
  return coupon;
}

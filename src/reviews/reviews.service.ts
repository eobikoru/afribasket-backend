import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Errors } from '../common/errors/app.exception';
import { rethrowUnique } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(customerId: string, productId: string, input: z.infer<typeof reviewSchema>) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw Errors.notFound('Product not found');
    const purchase = await this.prisma.orderItem.findFirst({
      where: { productId, order: { customerId, status: 'delivered' } },
    });
    if (!purchase) throw Errors.forbidden('You can review a product after a delivered order that includes it');
    try {
      return await this.prisma.productReview.create({
        data: { productId, customerId, orderId: purchase.orderId, ...input },
      });
    } catch (error) {
      rethrowUnique(error, { productId: 'You have already reviewed this product' });
    }
  }

  async list(productId: string, page: number, perPage: number) {
    const where = { productId, isHidden: false };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: { id: true, rating: true, title: true, body: true, createdAt: true, customer: { select: { firstName: true } } },
      }),
    ]);
    return { items, page, perPage, total };
  }

  async setHidden(id: string, isHidden: boolean) {
    try {
      return await this.prisma.productReview.update({ where: { id }, data: { isHidden } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw Errors.notFound('Review not found');
      throw error;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma, ShippingCarrier } from '@prisma/client';
import { NotificationService } from '../email/notification.service';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';
import type { z } from 'zod';
import type { adminOrderQuery } from './orders.schemas';

const orderInclude = {
  items: true,
  notes: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.OrderInclude;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending: [OrderStatus.cancelled],
  processing: [OrderStatus.shipped, OrderStatus.cancelled],
  shipped: [OrderStatus.delivered],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationService,
  ) {}

  async listMine(customerId: string, page: number, perPage: number) {
    const where = { customerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    return { items: rows.map((order) => this.present(order, false)), page, perPage, total };
  }

  async getOwned(orderNumber: string, customerId: string | undefined, email: string | undefined) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber }, include: orderInclude });
    if (!order) throw Errors.notFound('Order not found');
    const owner = customerId && order.customerId === customerId;
    const guest = email && order.email === email.toLowerCase();
    if (!owner && !guest) throw Errors.notFound('Order not found');
    return this.present(order, false);
  }

  async track(orderNumber: string, email?: string, phone?: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber }, include: orderInclude });
    if (!order) throw Errors.notFound('Order not found');
    const emailMatch = email && order.email === email.toLowerCase();
    const phoneMatch = phone && order.phone && normalizePhone(phone) === normalizePhone(order.phone);
    if (!emailMatch && !phoneMatch) throw Errors.notFound('Order not found');
    return this.present(order, false);
  }

  async adminList(query: z.infer<typeof adminOrderQuery>) {
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status as OrderStatus } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus as PaymentStatus } : {}),
      ...(query.provider ? { paymentProvider: query.provider } : {}),
      ...(query.from || query.to
        ? { createdAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } }
        : {}),
      ...(query.q
        ? { OR: [{ orderNumber: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };
    const orderBy =
      query.sort === 'oldest'
        ? { createdAt: 'asc' as const }
        : query.sort === 'total_asc'
          ? { totalCents: 'asc' as const }
          : query.sort === 'total_desc'
            ? { totalCents: 'desc' as const }
            : { createdAt: 'desc' as const };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    return { items: rows.map((order) => this.present(order, true)), page: query.page, perPage: query.perPage, total };
  }

  async adminGet(orderNumber: string) {
    const order = await this.require(orderNumber);
    return this.present(order, true);
  }

  async updateStatus(orderNumber: string, status: 'cancelled' | 'shipped' | 'delivered', adminId: string) {
    const order = await this.require(orderNumber);
    const allowed = TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status as OrderStatus)) throw Errors.conflict(`Cannot move an order from ${order.status} to ${status}`);
    if (status === 'shipped' && !order.trackingNumber) throw Errors.badRequest('Add a tracking number before marking the order shipped');
    if (status === 'cancelled') {
      await this.prisma.$transaction(async (tx) => {
        if (order.status === 'pending') await this.inventory.releaseReservation(tx, order.id, 'Cancelled by admin');
        else {
          await this.inventory.returnItems(
            tx,
            order.id,
            order.items.filter((item) => item.returnedQuantity < item.quantity).map((item) => ({
              orderItemId: item.id,
              quantity: item.quantity - item.returnedQuantity,
            })),
            'Cancelled by admin',
            adminId,
          );
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'cancelled', cancelledAt: new Date(), paymentStatus: order.paymentStatus === 'pending' ? 'failed' : order.paymentStatus },
        });
      });
      await this.notifications.sendCancelled(order.email, order.orderNumber, 'Your order was cancelled.');
    } else if (status === 'delivered') {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'delivered', deliveredAt: new Date() } });
      await this.notifications.sendDelivered(order.email, order.orderNumber);
    } else {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'shipped', shippedAt: order.shippedAt ?? new Date() } });
      await this.notifications.sendShipped(order.email, order.orderNumber, order.trackingCarrier ?? 'carrier', order.trackingNumber ?? '');
    }
    return this.adminGet(orderNumber);
  }

  async setTracking(orderNumber: string, carrier: ShippingCarrier, trackingNumber: string) {
    const order = await this.require(orderNumber);
    if (order.status !== 'processing' && order.status !== 'shipped') {
      throw Errors.conflict('Tracking can be added once the order is processing');
    }
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        trackingCarrier: carrier,
        trackingNumber,
        status: 'shipped',
        shippedAt: order.shippedAt ?? new Date(),
      },
    });
    await this.notifications.sendShipped(order.email, order.orderNumber, carrier, trackingNumber);
    return this.adminGet(orderNumber);
  }

  async addNote(orderNumber: string, adminId: string, body: string, isInternal: boolean) {
    const order = await this.require(orderNumber);
    await this.prisma.orderNote.create({ data: { orderId: order.id, adminId, body, isInternal } });
    return this.adminGet(orderNumber);
  }

  async refund(orderNumber: string, amountCents: number | undefined) {
    const order = await this.require(orderNumber);
    const updated = await this.payments.refund(order.id, amountCents);
    if (updated) await this.notifications.sendRefund(updated.email, updated.orderNumber, amountCents ?? order.totalCents - order.refundedCents);
    return this.adminGet(orderNumber);
  }

  async returnStock(orderNumber: string, adminId: string, items: Array<{ orderItemId: string; quantity: number }>) {
    const order = await this.require(orderNumber);
    await this.prisma.$transaction((tx) => this.inventory.returnItems(tx, order.id, items, 'Admin marked items returned', adminId));
    return this.adminGet(orderNumber);
  }

  private async require(orderNumber: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber }, include: orderInclude });
    if (!order) throw Errors.notFound('Order not found');
    return order;
  }

  private present(order: OrderRecord, admin: boolean) {
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentProvider: order.paymentProvider,
      email: order.email,
      customerName: order.customerName,
      phone: order.phone,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      refundedCents: order.refundedCents,
      couponCode: order.couponCode,
      shippingMethod: order.shippingMethod,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      shippingExplanation: order.shippingExplanation,
      taxExplanation: order.taxExplanation,
      taxState: order.taxState,
      taxRateBps: order.taxRateBps,
      deliveryNote: order.deliveryNote,
      substitutionPreference: order.substitutionPreference,
      trackingNumber: order.trackingNumber,
      trackingCarrier: order.trackingCarrier,
      paidAt: order.paidAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      createdAt: order.createdAt,
      items: order.items,
      notes: order.notes.filter((note) => admin || !note.isInternal),
      ...(admin
        ? {
            id: order.id,
            customerId: order.customerId,
            reviewRequired: order.reviewRequired,
            stockReturned: order.stockReturned,
            paymentReference: order.paymentReference,
            paymentMetadata: order.paymentMetadata,
            reservationExpiresAt: order.reservationExpiresAt,
          }
        : {}),
    };
  }
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const normalized = digits.length === 10 ? `1${digits}` : digits;
  return normalized;
}

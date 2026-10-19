import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { NotificationService } from '../email/notification.service';
import { Errors } from '../common/errors/app.exception';
import { asJson } from '../common/prisma-errors';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { decidePaymentCapture } from '../payments/payment-decision';

@Injectable()
export class OrderSettlementService {
  private readonly logger = new Logger(OrderSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationService,
  ) {}

  async markPaidFromProvider(input: {
    orderId?: string;
    orderNumber?: string;
    providerReference?: string;
    paidAmountCents: number;
    metadata: unknown;
  }) {
    const order = await this.find(input);
    const decision = decidePaymentCapture({
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      orderTotalCents: order.totalCents,
      paidAmountCents: input.paidAmountCents,
    });
    if (decision === 'already_settled') return { result: 'already_settled' as const, order };
    if (decision === 'mismatch') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          reviewRequired: true,
          paymentReference: input.providerReference ?? order.paymentReference,
          paymentMetadata: asJson({ ...(readObject(order.paymentMetadata)), amountMismatch: true, paidAmountCents: input.paidAmountCents, expectedCents: order.totalCents, providerPayload: input.metadata }),
        },
      });
      this.logger.error({
        msg: 'payment_amount_mismatch',
        orderId: order.id,
        orderNumber: order.orderNumber,
        expectedCents: order.totalCents,
        paidAmountCents: input.paidAmountCents,
        provider: order.paymentProvider,
      });
      return { result: 'mismatch' as const, order };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: order.id } });
      if (!current) return;
      const again = decidePaymentCapture({
        orderStatus: current.status,
        paymentStatus: current.paymentStatus,
        orderTotalCents: current.totalCents,
        paidAmountCents: input.paidAmountCents,
      });
      if (again !== 'capture') return;
      await this.inventory.sellReserved(tx, current.id);
      await tx.order.update({
        where: { id: current.id },
        data: {
          status: 'processing',
          paymentStatus: PaymentStatus.completed,
          paidAt: new Date(),
          paymentReference: input.providerReference ?? current.paymentReference,
          paymentMetadata: asJson({ ...(readObject(current.paymentMetadata)), providerPayload: input.metadata }),
        },
      });
    });
    const paid = await this.prisma.order.findUnique({ where: { id: order.id } });
    if (paid?.paymentStatus === 'completed' && paid.status === 'processing') {
      await this.notifications.sendPaymentConfirmed(paid.email, paid.orderNumber, paid.totalCents);
      await this.notifications.sendProcessing(paid.email, paid.orderNumber, paid.totalCents);
      await this.notifications.sendAdminPaidAlert(paid.orderNumber, paid.totalCents, paid.email);
    }
    return { result: 'captured' as const, order: paid ?? order };
  }

  async markFailed(orderId: string, reason: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.reviewRequired || order.status !== 'pending') return order;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (!current || current.status !== 'pending' || current.reviewRequired) return;
      await this.inventory.releaseReservation(tx, orderId, reason);
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'cancelled', paymentStatus: PaymentStatus.failed, cancelledAt: new Date() },
      });
    });
    await this.notifications.sendCancelled(order.email, order.orderNumber, reason);
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  async releaseExpiredReservations(): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        paymentStatus: 'pending',
        reviewRequired: false,
        reservationExpiresAt: { lt: new Date() },
      },
    });
    let released = 0;
    for (const order of orders) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({ where: { id: order.id } });
        if (!current || current.status !== 'pending' || current.paymentStatus !== 'pending' || current.reviewRequired) {
          return false;
        }
        await this.inventory.releaseReservation(tx, order.id, 'Reservation expired');
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'cancelled', paymentStatus: PaymentStatus.failed, cancelledAt: new Date() },
        });
        return true;
      });
      if (changed) {
        released += 1;
        await this.notifications.sendCancelled(order.email, order.orderNumber, 'The payment window expired and the order was cancelled.');
      }
    }
    return released;
  }

  async recordRefund(orderId: string, amountCents: number, metadata: unknown, providerRefundId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw Errors.notFound('Order not found');
    const meta = readObject(order.paymentMetadata);
    const seen = Array.isArray(meta.refundIds) ? meta.refundIds.map(String) : [];
    if (providerRefundId && seen.includes(providerRefundId)) return order;
    if (amountCents <= 0) return order;
    const refundedCents = Math.min(order.totalCents, order.refundedCents + amountCents);
    const full = refundedCents >= order.totalCents;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          refundedCents,
          paymentStatus: full ? PaymentStatus.refunded : PaymentStatus.partially_refunded,
          status: full ? 'refunded' : order.status,
          paymentMetadata: asJson({
            ...meta,
            refund: metadata,
            refundIds: providerRefundId ? [...seen, providerRefundId] : seen,
          }),
        },
      });
      if (full && !order.stockReturned) {
        await this.inventory.returnItems(
          tx,
          orderId,
          order.items.filter((item) => item.returnedQuantity < item.quantity).map((item) => ({
            orderItemId: item.id,
            quantity: item.quantity - item.returnedQuantity,
          })),
          'Full refund',
        );
      }
    });
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  private async find(input: { orderId?: string; orderNumber?: string }) {
    const order = input.orderId
      ? await this.prisma.order.findUnique({ where: { id: input.orderId } })
      : await this.prisma.order.findUnique({ where: { orderNumber: input.orderNumber ?? '' } });
    if (!order) throw Errors.notFound('Order not found');
    return order;
  }
}

function readObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

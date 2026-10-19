import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma, ShippingMethod, SubstitutionPreference } from '@prisma/client';
import type { AppConfig } from '../config/configuration';
import type { UsAddress } from '../common/address';
import { AppException, Errors } from '../common/errors/app.exception';
import { asJson } from '../common/prisma-errors';
import { CartService } from '../cart/cart.service';
import type { RequestedLine } from '../catalog/resolve-lines';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';

export interface CheckoutCommand {
  lines: RequestedLine[];
  email: string;
  customerName: string;
  phone?: string;
  customerId?: string;
  shippingAddress: UsAddress;
  billingAddress: UsAddress;
  shippingMethod: ShippingMethod;
  couponCode?: string;
  paymentProvider: 'stripe' | 'paypal';
  deliveryNote?: string;
  substitutionPreference?: SubstitutionPreference;
  clearCart?: { customerId?: string; guestToken?: string };
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly carts: CartService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async breakdown(input: {
    lines: RequestedLine[];
    address: UsAddress;
    shippingMethod: ShippingMethod;
    couponCode?: string;
    customerId?: string;
    email?: string;
  }) {
    const priced = await this.pricing.price(input, this.prisma);
    return {
      lines: priced.lines,
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      shippingCents: priced.shippingCents,
      taxCents: priced.taxCents,
      totalCents: priced.totalCents,
      currency: priced.currency,
      shippingExplanation: priced.shippingExplanation,
      taxExplanation: priced.taxExplanation,
      allowedShippingMethods: priced.allowedShippingMethods,
    };
  }

  async checkout(command: CheckoutCommand, payments: { createSession(order: PayableOrder): Promise<PaymentSession> }) {
    const minutes = this.config.get('reservationMinutes', { infer: true });
    const order = await this.prisma.$transaction(async (tx) => {
      await this.lockLines(tx, command.lines);
      const priced = await this.pricing.price(
        {
          lines: command.lines,
          address: command.shippingAddress,
          shippingMethod: command.shippingMethod,
          couponCode: command.couponCode,
          customerId: command.customerId,
          email: command.email,
        },
        tx,
      );
      const orderNumber = await this.nextOrderNumber(tx);
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId: command.customerId,
          email: command.email.toLowerCase(),
          customerName: command.customerName,
          phone: command.phone,
          paymentProvider: command.paymentProvider,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          shippingCents: priced.shippingCents,
          taxCents: priced.taxCents,
          totalCents: priced.totalCents,
          couponId: priced.couponId,
          couponCode: priced.couponCode,
          shippingMethod: command.shippingMethod,
          shippingAddress: asJson(command.shippingAddress),
          billingAddress: asJson(command.billingAddress),
          shippingExplanation: priced.shippingExplanation,
          taxExplanation: priced.taxExplanation,
          taxState: priced.taxState,
          taxRateBps: priced.taxRateBps,
          taxCalculationId: priced.taxCalculationId,
          deliveryNote: command.deliveryNote,
          substitutionPreference: command.substitutionPreference,
          reservationExpiresAt: new Date(Date.now() + minutes * 60 * 1000),
          currency: 'USD',
        },
      });
      const items = [];
      for (const line of priced.lines) {
        items.push(
          await tx.orderItem.create({
            data: {
              orderId: created.id,
              productId: line.productId,
              variantId: line.variantId,
              name: line.name,
              sku: line.sku,
              unitPriceCents: line.unitPriceCents,
              quantity: line.quantity,
              imageUrl: line.imageUrl,
              storageType: line.storageType,
              lineTotalCents: line.lineTotalCents,
            },
          }),
        );
      }
      await this.inventory.reserveLines(
        tx,
        created.id,
        items.map((item, index) => ({
          orderItemId: item.id,
          productId: item.productId ?? priced.lines[index].productId,
          variantId: item.variantId,
          quantity: item.quantity,
          requiresLot: priced.lines[index].requiresLot,
        })),
      );
      if (priced.couponId) {
        await tx.couponRedemption.create({
          data: {
            couponId: priced.couponId,
            orderId: created.id,
            customerId: command.customerId,
            email: command.email.toLowerCase(),
          },
        });
      }
      return { order: created, items, priced };
    });

    try {
      const session = await payments.createSession({
        id: order.order.id,
        orderNumber: order.order.orderNumber,
        email: order.order.email,
        customerName: order.order.customerName,
        paymentProvider: command.paymentProvider,
        totalCents: order.order.totalCents,
        subtotalCents: order.order.subtotalCents,
        discountCents: order.order.discountCents,
        shippingCents: order.order.shippingCents,
        taxCents: order.order.taxCents,
        items: order.items.map((item) => ({
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
        })),
        shippingAddress: command.shippingAddress,
      });
      await this.prisma.order.update({
        where: { id: order.order.id },
        data: {
          paymentReference: session.reference,
          paymentMetadata: asJson({ session: session.clientPayload }),
        },
      });
      if (command.clearCart?.customerId) await this.carts.clearCustomer(command.clearCart.customerId);
      if (command.clearCart?.guestToken) await this.carts.clearGuest(command.clearCart.guestToken);
      return {
        orderNumber: order.order.orderNumber,
        status: order.order.status,
        paymentStatus: order.order.paymentStatus,
        totalCents: order.order.totalCents,
        currency: 'USD' as const,
        reservationExpiresAt: order.order.reservationExpiresAt,
        payment: session,
      };
    } catch (error) {
      this.logger.error({
        msg: 'payment_session_failed',
        orderNumber: order.order.orderNumber,
        error: error instanceof Error ? error.message : 'unknown',
      });
      await this.prisma.$transaction(async (tx) => {
        await this.inventory.releaseReservation(tx, order.order.id, 'Payment session failed');
        await tx.order.update({
          where: { id: order.order.id },
          data: { status: 'cancelled', paymentStatus: PaymentStatus.failed, cancelledAt: new Date() },
        });
      });
      if (error instanceof AppException) throw error;
      throw Errors.provider(error instanceof Error ? error.message : 'Unable to start payment');
    }
  }

  private async lockLines(tx: Prisma.TransactionClient, lines: RequestedLine[]) {
    const ordered = [...lines].sort((a, b) => (a.variantId ?? a.productId).localeCompare(b.variantId ?? b.productId));
    for (const line of ordered) {
      if (line.variantId) {
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${line.variantId} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "Inventory" WHERE "productId" = ${line.productId} FOR UPDATE`;
      }
    }
  }

  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_number_seq') AS nextval`;
    const next = rows[0]?.nextval;
    if (next == null) throw Errors.unavailable('Order numbers are unavailable');
    return `AB-${next.toString()}`;
  }
}

export interface PayableOrder {
  id: string;
  orderNumber: string;
  email: string;
  customerName: string;
  paymentProvider: 'stripe' | 'paypal';
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  items: Array<{ name: string; sku: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  shippingAddress: UsAddress;
}

export interface PaymentSession {
  provider: 'stripe' | 'paypal';
  reference: string;
  approvalUrl: string | null;
  clientPayload: Record<string, unknown>;
}

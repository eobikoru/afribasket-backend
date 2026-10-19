import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { Errors } from '../common/errors/app.exception';
import { asJson } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OrderSettlementService } from '../orders/order-settlement.service';
import type { PayableOrder, PaymentSession } from '../orders/checkout.service';
import { decimalStringToCents } from '../common/money';
import { PayPalClient } from './paypal.client';
import { StripePayments } from './stripe.payments';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly stripe: StripePayments,
    private readonly paypal: PayPalClient,
    private readonly settlement: OrderSettlementService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  createSession(order: PayableOrder): Promise<PaymentSession> {
    if (order.totalCents < 50) throw Errors.unprocessable('Order total must be at least $0.50');
    return order.paymentProvider === 'paypal' ? this.paypal.createOrder(order) : this.stripe.createSession(order);
  }

  async verify(orderNumber: string, providerReference?: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber } });
    if (!order) throw Errors.notFound('Order not found');
    if (order.paymentStatus === 'completed' || order.paymentStatus === 'refunded' || order.paymentStatus === 'partially_refunded') {
      return { orderNumber, status: order.status, paymentStatus: order.paymentStatus };
    }
    const reference = providerReference ?? order.paymentReference;
    if (!reference || (order.paymentReference && providerReference && providerReference !== order.paymentReference)) {
      throw Errors.badRequest('Payment reference does not match this order');
    }
    if (order.paymentProvider === 'paypal') {
      const capture = await this.paypal.capture(reference);
      const result = await this.settlement.markPaidFromProvider({
        orderId: order.id,
        providerReference: reference,
        paidAmountCents: capture.amountCents,
        metadata: { captureId: capture.captureId, capture: capture.raw },
      });
      if (capture.status === 'DECLINED' || capture.status === 'FAILED') await this.settlement.markFailed(order.id, 'PayPal capture was denied');
      return { orderNumber, result: result.result, status: result.order.status, paymentStatus: result.order.paymentStatus };
    }
    const session = await this.stripe.retrieveSession(reference);
    if (session.payment_status === 'paid') {
      const result = await this.settlement.markPaidFromProvider({
        orderId: order.id,
        providerReference: reference,
        paidAmountCents: session.amount_total ?? 0,
        metadata: { paymentIntent: paymentIntentId(session.payment_intent), sessionStatus: session.status },
      });
      return { orderNumber, result: result.result, status: result.order.status, paymentStatus: result.order.paymentStatus };
    }
    if (session.status === 'expired') {
      await this.settlement.markFailed(order.id, 'Checkout session expired');
    }
    const fresh = await this.prisma.order.findUnique({ where: { id: order.id } });
    return { orderNumber, status: fresh?.status, paymentStatus: fresh?.paymentStatus };
  }

  async refund(orderId: string, amountCents?: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw Errors.notFound('Order not found');
    if (order.paymentStatus !== 'completed' && order.paymentStatus !== 'partially_refunded') {
      throw Errors.conflict('This order has no captured payment to refund');
    }
    const remaining = order.totalCents - order.refundedCents;
    const amount = amountCents ?? remaining;
    if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) throw Errors.badRequest('Refund amount is invalid');
    const meta = readObject(order.paymentMetadata);
    if (order.paymentProvider === 'stripe') {
      const paymentIntent = stringValue(meta.paymentIntent) ?? (await this.intentFromSession(order.paymentReference));
      if (!paymentIntent) throw Errors.conflict('Stripe payment intent is missing');
      const refund = await this.stripe.refund(paymentIntent, amount);
      const updated = await this.settlement.recordRefund(order.id, amount, refund.raw, refund.id);
      return updated;
    }
    const captureId = stringValue(meta.captureId);
    if (!captureId) throw Errors.conflict('PayPal capture id is missing');
    const refund = await this.paypal.refund(captureId, amount, order.orderNumber);
    return this.settlement.recordRefund(order.id, amount, refund.raw, refund.id);
  }

  async handleStripe(headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const event = this.stripe.verifyWebhook(rawBody, header(headers, 'stripe-signature'));
    const fresh = await this.begin('stripe', event.id, event.type, event);
    if (!fresh) return { received: true, duplicate: true };
    try {
      await this.dispatchStripe(event);
      await this.finish('stripe', event.id);
    } catch (error) {
      await this.prisma.webhookEvent.delete({ where: { provider_eventId: { provider: 'stripe', eventId: event.id } } }).catch(() => undefined);
      throw error;
    }
    return { received: true };
  }

  async handlePayPal(headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const event = (await this.paypal.verifyWebhook(headers, rawBody)) as {
      id: string;
      event_type: string;
      resource?: Record<string, unknown>;
    };
    const fresh = await this.begin('paypal', event.id, event.event_type, event);
    if (!fresh) return { received: true, duplicate: true };
    try {
      await this.dispatchPayPal(event);
      await this.finish('paypal', event.id);
    } catch (error) {
      await this.prisma.webhookEvent.delete({ where: { provider_eventId: { provider: 'paypal', eventId: event.id } } }).catch(() => undefined);
      throw error;
    }
    return { received: true };
  }

  private async dispatchStripe(event: Stripe.Event) {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId ?? session.client_reference_id ?? undefined;
      if (!orderId || session.payment_status !== 'paid') return;
      await this.settlement.markPaidFromProvider({
        orderId,
        providerReference: session.id,
        paidAmountCents: session.amount_total ?? 0,
        metadata: { paymentIntent: paymentIntentId(session.payment_intent), eventId: event.id },
      });
      return;
    }
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId ?? session.client_reference_id;
      if (orderId) await this.settlement.markFailed(orderId, 'Checkout session expired');
      return;
    }
    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata?.orderId;
      if (orderId) await this.settlement.markFailed(orderId, 'Payment failed');
      return;
    }
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const order = await this.orderForStripeCharge(charge);
      if (!order) return;
      const delta = charge.amount_refunded - order.refundedCents;
      if (delta > 0) await this.settlement.recordRefund(order.id, delta, { chargeId: charge.id }, `stripe-charge-${charge.id}-${charge.amount_refunded}`);
    }
  }

  private async dispatchPayPal(event: { id: string; event_type: string; resource?: Record<string, unknown> }) {
    const resource = event.resource ?? {};
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const paypalOrderId = stringValue(resource.id);
      if (!paypalOrderId) return;
      const order = await this.prisma.order.findFirst({ where: { paymentReference: paypalOrderId, paymentProvider: 'paypal' } });
      if (!order) return;
      const capture = await this.paypal.capture(paypalOrderId);
      await this.settlement.markPaidFromProvider({
        orderId: order.id,
        providerReference: paypalOrderId,
        paidAmountCents: capture.amountCents,
        metadata: { captureId: capture.captureId, eventId: event.id },
      });
      return;
    }
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' || event.event_type === 'PAYMENT.CAPTURE.DENIED') {
      const customId = stringValue(resource.custom_id);
      const amount = resource.amount && typeof resource.amount === 'object' ? stringValue((resource.amount as { value?: string }).value) : undefined;
      const order = customId
        ? await this.prisma.order.findUnique({ where: { id: customId } })
        : await this.prisma.order.findFirst({ where: { paymentReference: stringValue(resource.supplementary_data as never) ?? '' } });
      const linked = order ?? (await this.orderByCapture(resource));
      if (!linked) return;
      if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
        await this.settlement.markFailed(linked.id, 'PayPal capture was denied');
        return;
      }
      await this.settlement.markPaidFromProvider({
        orderId: linked.id,
        paidAmountCents: amount ? decimalStringToCents(amount) : linked.totalCents,
        providerReference: linked.paymentReference ?? undefined,
        metadata: { captureId: stringValue(resource.id), eventId: event.id },
      });
      return;
    }
    if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
      const amountValue = resource.amount && typeof resource.amount === 'object' ? stringValue((resource.amount as { value?: string }).value) : undefined;
      const order = await this.orderForPayPalRefund(resource);
      if (!order || !amountValue) return;
      await this.settlement.recordRefund(order.id, decimalStringToCents(amountValue), resource, stringValue(resource.id));
    }
  }

  private async orderForStripeCharge(charge: Stripe.Charge) {
    const paymentIntent = paymentIntentId(charge.payment_intent);
    if (!paymentIntent) return null;
    return this.prisma.order.findFirst({
      where: { paymentProvider: 'stripe', paymentMetadata: { path: ['paymentIntent'], equals: paymentIntent } },
    });
  }

  private async orderForPayPalRefund(resource: Record<string, unknown>) {
    const custom = stringValue(resource.custom_id);
    if (custom) {
      const byId = await this.prisma.order.findUnique({ where: { id: custom } });
      if (byId) return byId;
      const byNumber = await this.prisma.order.findUnique({ where: { orderNumber: custom } });
      if (byNumber) return byNumber;
    }
    const invoice = stringValue(resource.invoice_id);
    if (invoice) {
      const byInvoice = await this.prisma.order.findUnique({ where: { orderNumber: invoice } });
      if (byInvoice) return byInvoice;
    }
    const captureId = captureIdFromRefund(resource);
    if (!captureId) return null;
    return this.prisma.order.findFirst({
      where: { paymentProvider: 'paypal', paymentMetadata: { path: ['captureId'], equals: captureId } },
    });
  }

  private async orderByCapture(resource: Record<string, unknown>) {
    const custom = stringValue(resource.custom_id);
    if (custom) return this.prisma.order.findUnique({ where: { id: custom } });
    const captureId = stringValue(resource.id);
    if (!captureId) return null;
    return this.prisma.order.findFirst({
      where: { paymentProvider: 'paypal', paymentMetadata: { path: ['captureId'], equals: captureId } },
    });
  }

  private async intentFromSession(reference: string | null): Promise<string | undefined> {
    if (!reference) return undefined;
    const session = await this.stripe.retrieveSession(reference);
    return paymentIntentId(session.payment_intent);
  }

  private async begin(provider: 'stripe' | 'paypal', eventId: string, type: string, payload: unknown): Promise<boolean> {
    const key = `webhook:${provider}:${eventId}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached === 'done') return false;
    try {
      await this.prisma.webhookEvent.create({ data: { provider, eventId, type, payload: asJson(payload) } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider, eventId } } });
        return !existing?.processedAt;
      }
      throw error;
    }
  }

  private async finish(provider: 'stripe' | 'paypal', eventId: string) {
    await this.prisma.webhookEvent.update({
      where: { provider_eventId: { provider, eventId } },
      data: { processedAt: new Date() },
    });
    await this.redis.set(`webhook:${provider}:${eventId}`, 'done', 60 * 60 * 24 * 7).catch(() => undefined);
  }
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function paymentIntentId(value: string | Stripe.PaymentIntent | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.id;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function captureIdFromRefund(resource: Record<string, unknown>): string | undefined {
  const links = Array.isArray(resource.links) ? resource.links : [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const href = stringValue((link as { href?: string }).href);
    if (!href) continue;
    const match = href.match(/\/captures\/([A-Za-z0-9]+)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function readObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

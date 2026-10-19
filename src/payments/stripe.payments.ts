import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { distributeDiscount } from '../tax/tax.service';
import type { PayableOrder, PaymentSession } from '../orders/checkout.service';

@Injectable()
export class StripePayments {
  private readonly logger = new Logger(StripePayments.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  client(): Stripe {
    const secret = this.config.get('stripe', { infer: true }).secretKey;
    if (!secret) throw Errors.unavailable('Stripe is not configured');
    return new Stripe(secret);
  }

  async createSession(order: PayableOrder): Promise<PaymentSession> {
    const stripe = this.client();
    const checkout = this.config.get('checkout', { infer: true });
    const discounted = distributeDiscount(
      order.items.map((item) => item.lineTotalCents),
      order.discountCents,
    );
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.flatMap((item, index) => {
      const amount = discounted[index] ?? 0;
      if (amount <= 0) return [];
      return [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amount,
          product_data: { name: `${item.quantity} × ${item.name}`.slice(0, 250) },
        },
      }];
    });
    if (order.shippingCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: order.shippingCents, product_data: { name: 'Shipping' } },
      });
    }
    if (order.taxCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: order.taxCents, product_data: { name: 'Tax' } },
      });
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: order.id,
        customer_email: order.email,
        success_url: `${checkout.successUrl}?order=${encodeURIComponent(order.orderNumber)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: checkout.cancelUrl,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        payment_method_types: ['card', 'link'],
        line_items: lineItems,
      },
      { idempotencyKey: `checkout-${order.id}` },
    );
    return {
      provider: 'stripe',
      reference: session.id,
      approvalUrl: session.url,
      clientPayload: { sessionId: session.id, url: session.url },
    };
  }

  async refund(paymentIntentId: string, amountCents: number): Promise<{ id: string; raw: Stripe.Refund }> {
    const refund = await this.client().refunds.create({ payment_intent: paymentIntentId, amount: amountCents });
    return { id: refund.id, raw: refund };
  }

  async retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.client().checkout.sessions.retrieve(sessionId);
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const secret = this.config.get('stripe', { infer: true }).webhookSecret;
    if (!secret || !signature) throw Errors.unauthorized('Invalid Stripe signature');
    try {
      return this.client().webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      this.logger.warn({ msg: 'stripe_signature_rejected' });
      throw Errors.unauthorized('Invalid Stripe signature');
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { EMAIL_SENDER, type EmailSender } from './email.sender';
import { orderEmail, passwordResetEmail } from './email.templates';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const content = passwordResetEmail(this.config.get('storefrontUrl', { infer: true }), token);
    await this.safe(email, 'Reset your AfriBasket password', content);
  }

  async sendPaymentConfirmed(email: string, orderNumber: string, totalCents: number): Promise<void> {
    const content = orderEmail({
      title: 'Payment confirmed',
      orderNumber,
      totalCents,
      detail: 'We received your payment. Your order is moving into processing.',
    });
    await this.safe(email, `Payment confirmed · ${orderNumber}`, content);
  }

  async sendProcessing(email: string, orderNumber: string, totalCents: number): Promise<void> {
    const content = orderEmail({
      title: 'Your order is being prepared',
      orderNumber,
      totalCents,
      detail: 'We are packing your AfriBasket order.',
    });
    await this.safe(email, `Order processing · ${orderNumber}`, content);
  }

  async sendShipped(email: string, orderNumber: string, carrier: string, trackingNumber: string): Promise<void> {
    const content = orderEmail({
      title: 'Your order has shipped',
      orderNumber,
      detail: `Carrier: ${carrier}. Tracking number: ${trackingNumber}.`,
    });
    await this.safe(email, `Shipped · ${orderNumber}`, content);
  }

  async sendDelivered(email: string, orderNumber: string): Promise<void> {
    const content = orderEmail({
      title: 'Your order was delivered',
      orderNumber,
      detail: 'We marked this order delivered. Enjoy the meal.',
    });
    await this.safe(email, `Delivered · ${orderNumber}`, content);
  }

  async sendCancelled(email: string, orderNumber: string, reason: string): Promise<void> {
    const content = orderEmail({
      title: 'Your order was cancelled',
      orderNumber,
      detail: reason,
    });
    await this.safe(email, `Cancelled · ${orderNumber}`, content);
  }

  async sendRefund(email: string, orderNumber: string, amountCents: number): Promise<void> {
    const content = orderEmail({
      title: 'Refund confirmed',
      orderNumber,
      totalCents: amountCents,
      detail: 'The refund has been submitted to your payment provider.',
    });
    await this.safe(email, `Refund confirmed · ${orderNumber}`, content);
  }

  async sendAdminPaidAlert(orderNumber: string, totalCents: number, email: string): Promise<void> {
    const content = orderEmail({
      title: 'Paid order',
      orderNumber,
      totalCents,
      detail: `Customer ${email} paid for ${orderNumber}.`,
    });
    await this.safe(this.config.get('email', { infer: true }).adminAlert, `Paid order ${orderNumber}`, content);
  }

  async sendOpsDigest(subject: string, text: string): Promise<void> {
    await this.safe(this.config.get('email', { infer: true }).adminAlert, subject, {
      html: `<pre style="font-family:ui-monospace,monospace">${escapeHtml(text)}</pre>`,
      text,
    });
  }

  private async safe(to: string, subject: string, content: { html: string; text: string }): Promise<void> {
    try {
      await this.sender.send({ to, subject, html: content.html, text: content.text });
    } catch (error) {
      this.logger.error({
        msg: 'notification_failed',
        subject,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

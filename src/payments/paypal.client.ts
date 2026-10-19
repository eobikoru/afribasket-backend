import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { centsToDecimalString, decimalStringToCents } from '../common/money';
import type { PayableOrder, PaymentSession } from '../orders/checkout.service';
import { assertPayPalCertUrl, verifyPayPalTransmission } from './paypal-signature';

interface PayPalOrder {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    reference_id?: string;
    payments?: { captures?: Array<{ id: string; status: string; amount: { value: string } }> };
  }>;
}

@Injectable()
export class PayPalClient {
  private readonly logger = new Logger(PayPalClient.name);
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async createOrder(order: PayableOrder): Promise<PaymentSession> {
    const success = this.config.get('checkout', { infer: true }).successUrl;
    const cancel = this.config.get('checkout', { infer: true }).cancelUrl;
    const address = order.shippingAddress;
    const created = await this.request<PayPalOrder>('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.orderNumber,
          custom_id: order.id,
          description: `AfriBasket ${order.orderNumber}`.slice(0, 127),
          amount: {
            currency_code: 'USD',
            value: centsToDecimalString(order.totalCents),
            breakdown: {
              item_total: { currency_code: 'USD', value: centsToDecimalString(order.subtotalCents) },
              shipping: { currency_code: 'USD', value: centsToDecimalString(order.shippingCents) },
              tax_total: { currency_code: 'USD', value: centsToDecimalString(order.taxCents) },
              discount: { currency_code: 'USD', value: centsToDecimalString(order.discountCents) },
            },
          },
          items: order.items.map((item) => ({
            name: item.name.slice(0, 127),
            sku: item.sku.slice(0, 127),
            quantity: String(item.quantity),
            unit_amount: { currency_code: 'USD', value: centsToDecimalString(item.unitPriceCents) },
          })),
          shipping: {
            type: 'SHIPPING',
            name: { full_name: order.customerName.slice(0, 300) },
            address: {
              address_line_1: address.line1,
              address_line_2: address.line2,
              admin_area_2: address.city,
              admin_area_1: address.state,
              postal_code: address.postalCode,
              country_code: 'US',
            },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'AfriBasket',
            shipping_preference: 'SET_PROVIDED_ADDRESS',
            user_action: 'PAY_NOW',
            payment_method_preference: 'UNRESTRICTED',
            return_url: `${success}?order=${encodeURIComponent(order.orderNumber)}`,
            cancel_url: cancel,
          },
        },
      },
    });
    const approval = created.links?.find((link) => link.rel === 'payer-action' || link.rel === 'approve')?.href ?? null;
    return {
      provider: 'paypal',
      reference: created.id,
      approvalUrl: approval,
      clientPayload: { paypalOrderId: created.id, approvalUrl: approval, enableFunding: ['venmo', 'paypal'] },
    };
  }

  async capture(paypalOrderId: string): Promise<{ captureId: string; amountCents: number; status: string; raw: unknown }> {
    const existing = await this.getOrder(paypalOrderId);
    const prior = existing.purchase_units?.[0]?.payments?.captures?.find((capture) => capture.status === 'COMPLETED');
    if (prior) return this.captured(prior, existing);
    const captured = await this.request<PayPalOrder>('POST', `/v2/checkout/orders/${paypalOrderId}/capture`, {});
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture) throw Errors.provider('PayPal did not return a capture');
    return this.captured(capture, captured);
  }

  async refund(captureId: string, amountCents: number, orderNumber?: string): Promise<{ id: string; raw: unknown }> {
    const raw = await this.request<{ id: string }>('POST', `/v2/payments/captures/${captureId}/refund`, {
      amount: { currency_code: 'USD', value: centsToDecimalString(amountCents) },
      invoice_id: orderNumber,
      custom_id: orderNumber,
    });
    return { id: raw.id, raw };
  }

  async getOrder(paypalOrderId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>('GET', `/v2/checkout/orders/${paypalOrderId}`);
  }

  async verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<unknown> {
    const webhookId = this.config.get('paypal', { infer: true }).webhookId;
    if (!webhookId) throw Errors.unavailable('PayPal webhooks are not configured');
    const transmissionId = header(headers, 'paypal-transmission-id');
    const transmissionTime = header(headers, 'paypal-transmission-time');
    const signature = header(headers, 'paypal-transmission-sig');
    const certUrl = header(headers, 'paypal-cert-url');
    const authAlgo = header(headers, 'paypal-auth-algo');
    if (!transmissionId || !transmissionTime || !signature || !certUrl) {
      throw Errors.unauthorized('Invalid PayPal signature');
    }
    try {
      assertPayPalCertUrl(certUrl);
    } catch {
      throw Errors.unauthorized('Invalid PayPal signature');
    }
    const cert = await this.cert(certUrl);
    const valid = verifyPayPalTransmission({
      transmissionId,
      transmissionTime,
      webhookId,
      rawBody,
      signature,
      certPem: cert,
      authAlgo,
    });
    if (!valid) throw Errors.unauthorized('Invalid PayPal signature');
    return JSON.parse(rawBody.toString('utf8')) as unknown;
  }

  private captured(capture: { id: string; status: string; amount: { value: string } }, raw: unknown) {
    return { captureId: capture.id, amountCents: decimalStringToCents(capture.amount.value), status: capture.status, raw };
  }

  private async cert(url: string): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Errors.unauthorized('Invalid PayPal signature');
    return response.text();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const paypal = this.config.get('paypal', { infer: true });
    if (!paypal.clientId || !paypal.clientSecret) throw Errors.unavailable('PayPal is not configured');
    const response = await fetch(`${paypal.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as T & { message?: string; details?: unknown }) : ({} as T);
    if (!response.ok) {
      this.logger.error({ msg: 'paypal_request_failed', path, status: response.status });
      throw Errors.provider('PayPal request failed', { status: response.status });
    }
    return parsed;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 15000) return this.token.value;
    const paypal = this.config.get('paypal', { infer: true });
    const credentials = Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString('base64');
    const response = await fetch(`${paypal.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Errors.provider('PayPal authentication failed');
    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
    return payload.access_token;
  }
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

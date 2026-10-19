import { createSign, generateKeyPairSync } from 'crypto';
import Stripe from 'stripe';
import { payPalCrc, verifyPayPalTransmission } from './paypal-signature';
import { PayPalClient } from './paypal.client';
import { PaymentsService } from './payments.service';
import { OrderSettlementService } from '../orders/order-settlement.service';
import { StripePayments } from './stripe.payments';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signPayPal(body: Buffer, transmissionId: string, transmissionTime: string, webhookId: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(`${transmissionId}|${transmissionTime}|${webhookId}|${payPalCrc(body)}`);
  signer.end();
  return signer.sign(privateKey).toString('base64');
}

function pendingOrder() {
  return {
    id: 'ord_1',
    email: 'guest@example.com',
    orderNumber: 'AB-100245',
    status: 'pending',
    paymentStatus: 'pending',
    reviewRequired: false,
    totalCents: 2500,
    refundedCents: 0,
    stockReturned: false,
    paymentMetadata: {},
    paymentProvider: 'stripe',
    paymentReference: null as string | null,
    items: [],
  };
}

function stack(order = pendingOrder()) {
  const inventory = { sellReserved: jest.fn(async () => undefined), releaseReservation: jest.fn(), returnItems: jest.fn() };
  const notifications = {
    sendCancelled: jest.fn(),
    sendPaymentConfirmed: jest.fn(),
    sendProcessing: jest.fn(),
    sendAdminPaidAlert: jest.fn(),
  };
  const prisma = {
    order: {
      findUnique: jest.fn(async () => ({ ...order })),
      findFirst: jest.fn(async () => ({ ...order })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(order, data)),
    },
    webhookEvent: {
      create: jest.fn(async () => ({ id: 'row' })),
      update: jest.fn(async () => ({})),
      delete: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => null),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    $queryRaw: async () => [],
  };
  const redis = { get: jest.fn(async () => null), set: jest.fn(async () => 'OK') };
  const settlement = new OrderSettlementService(prisma as never, inventory as never, notifications as never);
  return { order, inventory, prisma, redis, settlement };
}

describe('PayPal webhook signatures', () => {
  const webhookId = 'WH-1';
  const body = Buffer.from(JSON.stringify({ id: 'evt_ok', event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
  const transmissionId = 'tid-1';
  const transmissionTime = new Date().toISOString();

  it('accepts a current RSA signature and rejects a tampered one', () => {
    const signature = signPayPal(body, transmissionId, transmissionTime, webhookId);
    expect(verifyPayPalTransmission({
      transmissionId,
      transmissionTime,
      webhookId,
      rawBody: body,
      signature,
      certPem,
    })).toBe(true);
    expect(verifyPayPalTransmission({
      transmissionId,
      transmissionTime,
      webhookId,
      rawBody: body,
      signature: signature.slice(0, -4) + 'AAAA',
      certPem,
    })).toBe(false);
  });

  it('rejects a cert URL that is not hosted by PayPal', async () => {
    const client = new PayPalClient({ get: () => ({ webhookId }) } as never);
    await expect(client.verifyWebhook({
      'paypal-transmission-id': 'tid',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'abc',
      'paypal-cert-url': 'https://evil.example/cert.pem',
    }, Buffer.from('{}'))).rejects.toMatchObject({ status: 401 });
  });
});

describe('provider webhooks and amount matching', () => {
  const stripeSecret = 'whsec_test_secret';
  const stripeConfig = {
    get: (key: string) => (key === 'stripe' ? { secretKey: 'sk_test_123', webhookSecret: stripeSecret } : {}),
  };

  function stripeEvent(amountTotal: number): { payload: string; header: string } {
    const payload = JSON.stringify({
      id: 'evt_stripe_1',
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: amountTotal,
          metadata: { orderId: 'ord_1' },
          client_reference_id: 'ord_1',
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });
    return { payload, header };
  }

  it('rejects a Stripe webhook with a bad signature', async () => {
    const { settlement, prisma, redis } = stack();
    const stripe = new StripePayments(stripeConfig as never);
    const payments = new PaymentsService(stripe, {} as never, settlement, prisma as never, redis as never);
    const { payload } = stripeEvent(2500);
    await expect(payments.handleStripe({ 'stripe-signature': 't=1,v1=deadbeef' }, Buffer.from(payload))).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('accepts a signed Stripe webhook and holds the order when the amount does not match', async () => {
    const { settlement, prisma, redis, inventory, order } = stack();
    const stripe = new StripePayments(stripeConfig as never);
    const payments = new PaymentsService(stripe, {} as never, settlement, prisma as never, redis as never);
    const { payload, header } = stripeEvent(1000);
    await expect(payments.handleStripe({ 'stripe-signature': header }, Buffer.from(payload))).resolves.toEqual({ received: true });
    expect(order.reviewRequired).toBe(true);
    expect(order.status).toBe('pending');
    expect(inventory.sellReserved).not.toHaveBeenCalled();
  });

  it('accepts a signed PayPal capture and holds the order when the amount does not match', async () => {
    const { settlement, prisma, redis, inventory, order } = stack();
    order.paymentProvider = 'paypal';
    const webhookId = 'WH-1';
    const event = {
      id: 'WH-EVT-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-1', custom_id: 'ord_1', amount: { value: '10.00', currency_code: 'USD' } },
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const transmissionId = 'tid-paypal';
    const transmissionTime = new Date().toISOString();
    const signature = signPayPal(rawBody, transmissionId, transmissionTime, webhookId);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => certPem } as Response);
    const paypal = new PayPalClient({ get: () => ({ webhookId }) } as never);
    const payments = new PaymentsService({} as never, paypal, settlement, prisma as never, redis as never);
    try {
      await expect(payments.handlePayPal({
        'paypal-transmission-id': transmissionId,
        'paypal-transmission-time': transmissionTime,
        'paypal-transmission-sig': signature,
        'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT',
        'paypal-auth-algo': 'SHA256withRSA',
      }, rawBody)).resolves.toEqual({ received: true });
    } finally {
      fetchMock.mockRestore();
    }
    expect(order.reviewRequired).toBe(true);
    expect(order.status).toBe('pending');
    expect(inventory.sellReserved).not.toHaveBeenCalled();
  });

  it('rejects a PayPal webhook when the signature does not verify', async () => {
    const { settlement, prisma, redis } = stack();
    const rawBody = Buffer.from(JSON.stringify({ id: 'evt_bad', event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => certPem } as Response);
    const paypal = new PayPalClient({ get: () => ({ webhookId: 'WH-1' }) } as never);
    const payments = new PaymentsService({} as never, paypal, settlement, prisma as never, redis as never);
    try {
      await expect(payments.handlePayPal({
        'paypal-transmission-id': 'tid',
        'paypal-transmission-time': new Date().toISOString(),
        'paypal-transmission-sig': Buffer.from('not-a-signature').toString('base64'),
        'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT',
        'paypal-auth-algo': 'SHA256withRSA',
      }, rawBody)).rejects.toMatchObject({ status: 401 });
    } finally {
      fetchMock.mockRestore();
    }
  });
});

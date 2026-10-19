import { OrderSettlementService } from './order-settlement.service';

function pendingOrder() {
  return {
    id: 'ord_1',
    email: 'guest@example.com',
    orderNumber: 'AB-100245',
    status: 'pending',
    paymentStatus: 'pending',
    reviewRequired: false,
    reservationExpiresAt: new Date(Date.now() - 60_000),
    totalCents: 2500,
    refundedCents: 0,
    stockReturned: false,
    paymentMetadata: {} as Record<string, unknown>,
    paymentProvider: 'stripe',
    paymentReference: null as string | null,
    items: [] as Array<{ id: string; quantity: number; returnedQuantity: number }>,
  };
}

function harness(order = pendingOrder()) {
  const inventory = {
    releaseReservation: jest.fn(async () => true),
    sellReserved: jest.fn(async () => undefined),
    returnItems: jest.fn(async () => undefined),
  };
  const notifications = {
    sendCancelled: jest.fn(async () => undefined),
    sendPaymentConfirmed: jest.fn(async () => undefined),
    sendProcessing: jest.fn(async () => undefined),
    sendAdminPaidAlert: jest.fn(async () => undefined),
  };
  const prisma = {
    order: {
      findMany: jest.fn(async () => [order].filter((row) => row.status === 'pending' && !row.reviewRequired)),
      findUnique: jest.fn(async () => ({ ...order })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(order, data)),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    $queryRaw: async () => [],
  };
  const service = new OrderSettlementService(prisma as never, inventory as never, notifications as never);
  return { service, inventory, notifications, prisma, order };
}

describe('reservation expiry and payment capture', () => {
  it('cancels an expired unpaid order and releases its reservation', async () => {
    const { service, inventory, notifications, prisma, order } = harness();
    await expect(service.releaseExpiredReservations()).resolves.toBe(1);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        paymentStatus: 'pending',
        reviewRequired: false,
        reservationExpiresAt: { lt: expect.any(Date) },
      },
    });
    expect(inventory.releaseReservation).toHaveBeenCalledWith(prisma, 'ord_1', 'Reservation expired');
    expect(order.status).toBe('cancelled');
    expect(order.paymentStatus).toBe('failed');
    expect(notifications.sendCancelled).toHaveBeenCalled();
  });

  it('leaves a review-required order reserved when the payment amount did not match', async () => {
    const order = pendingOrder();
    order.reviewRequired = true;
    const { service, inventory } = harness(order);
    await expect(service.releaseExpiredReservations()).resolves.toBe(0);
    expect(inventory.releaseReservation).not.toHaveBeenCalled();
    expect(order.status).toBe('pending');
  });

  it('does not sell stock when the provider amount differs from the order total', async () => {
    const { service, inventory, order } = harness();
    const result = await service.markPaidFromProvider({
      orderId: order.id,
      paidAmountCents: 1000,
      providerReference: 'cs_test',
      metadata: { eventId: 'evt_1' },
    });
    expect(result.result).toBe('mismatch');
    expect(order.reviewRequired).toBe(true);
    expect(order.status).toBe('pending');
    expect(inventory.sellReserved).not.toHaveBeenCalled();
  });

  it('converts a matching payment into a sale and moves the order to processing', async () => {
    const { service, inventory, notifications, order } = harness();
    const result = await service.markPaidFromProvider({
      orderId: order.id,
      paidAmountCents: 2500,
      providerReference: 'cs_test',
      metadata: { eventId: 'evt_2' },
    });
    expect(result.result).toBe('captured');
    expect(inventory.sellReserved).toHaveBeenCalled();
    expect(order.status).toBe('processing');
    expect(order.paymentStatus).toBe('completed');
    expect(notifications.sendPaymentConfirmed).toHaveBeenCalled();
  });
});

import { GuestOrderClaimService } from './guest-claim.service';

describe('guest order claim', () => {
  it('links only unowned orders for the same email and reports a no-op on a second pass', async () => {
    const calls: unknown[] = [];
    const counts = [2, 0];
    const prisma = {
      order: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return { count: counts.shift() ?? 0 };
        },
      },
    };
    const service = new GuestOrderClaimService(prisma as never);
    await expect(service.claim('cust_1', 'Ada@Example.com')).resolves.toBe(2);
    await expect(service.claim('cust_1', 'ada@example.com')).resolves.toBe(0);
    expect(calls).toEqual([
      { where: { customerId: null, email: 'ada@example.com' }, data: { customerId: 'cust_1' } },
      { where: { customerId: null, email: 'ada@example.com' }, data: { customerId: 'cust_1' } },
    ]);
  });
});

import { evaluateCoupon, type CouponSnapshot } from './coupon.rules';

const now = new Date('2026-10-19T12:00:00Z');

function coupon(overrides: Partial<CouponSnapshot> = {}): CouponSnapshot {
  return {
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    active: true,
    ...overrides,
  };
}

const ctx = {
  subtotalCents: 2500,
  now,
  totalRedemptions: 0,
  customerRedemptions: 0,
};

describe('coupon rules', () => {
  it('applies an integer percent and a fixed amount without exceeding the subtotal', () => {
    expect(evaluateCoupon(coupon(), ctx)).toEqual({ ok: true, discountCents: 250 });
    expect(evaluateCoupon(coupon({ type: 'fixed_cents', value: 500 }), ctx)).toEqual({ ok: true, discountCents: 500 });
    expect(evaluateCoupon(coupon({ type: 'fixed_cents', value: 9000 }), ctx)).toEqual({ ok: true, discountCents: 2500 });
    expect(evaluateCoupon(coupon({ value: 100 }), { ...ctx, subtotalCents: 199 })).toEqual({ ok: true, discountCents: 199 });
  });

  it('rejects inactive, early, expired, and below-minimum coupons', () => {
    expect(evaluateCoupon(coupon({ active: false }), ctx).ok).toBe(false);
    expect(evaluateCoupon(coupon({ startsAt: new Date('2026-10-20T00:00:00Z') }), ctx).ok).toBe(false);
    expect(evaluateCoupon(coupon({ endsAt: new Date('2026-10-18T00:00:00Z') }), ctx).ok).toBe(false);
    expect(evaluateCoupon(coupon({ minSubtotalCents: 5000 }), ctx).ok).toBe(false);
  });

  it('enforces global and per-customer usage limits', () => {
    expect(evaluateCoupon(coupon({ usageLimit: 2 }), { ...ctx, totalRedemptions: 2 }).ok).toBe(false);
    expect(evaluateCoupon(coupon({ perCustomerLimit: 1 }), { ...ctx, customerRedemptions: 1 }).ok).toBe(false);
    expect(evaluateCoupon(coupon({ usageLimit: 2, perCustomerLimit: 1 }), ctx)).toEqual({ ok: true, discountCents: 250 });
  });

  it('rejects a percent outside 1 to 100', () => {
    expect(evaluateCoupon(coupon({ value: 101 }), ctx).ok).toBe(false);
  });
});

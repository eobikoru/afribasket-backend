import { percentOfCents } from '../common/money';

export interface CouponSnapshot {
  code: string;
  type: 'percent' | 'fixed_cents';
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  active: boolean;
}

export type CouponDecision =
  | { ok: true; discountCents: number }
  | { ok: false; reason: string };

export function evaluateCoupon(
  coupon: CouponSnapshot,
  ctx: {
    subtotalCents: number;
    now: Date;
    totalRedemptions: number;
    customerRedemptions: number;
  },
): CouponDecision {
  if (!coupon.active) return { ok: false, reason: 'This coupon is not active' };
  if (coupon.startsAt && ctx.now.getTime() < coupon.startsAt.getTime()) {
    return { ok: false, reason: 'This coupon is not active yet' };
  }
  if (coupon.endsAt && ctx.now.getTime() > coupon.endsAt.getTime()) {
    return { ok: false, reason: 'This coupon has expired' };
  }
  if (ctx.subtotalCents < coupon.minSubtotalCents) {
    return { ok: false, reason: 'Order subtotal does not meet the coupon minimum' };
  }
  if (coupon.usageLimit != null && ctx.totalRedemptions >= coupon.usageLimit) {
    return { ok: false, reason: 'This coupon has reached its usage limit' };
  }
  if (coupon.perCustomerLimit != null && ctx.customerRedemptions >= coupon.perCustomerLimit) {
    return { ok: false, reason: 'You have already used this coupon the maximum number of times' };
  }
  if (coupon.type === 'percent') {
    if (!Number.isInteger(coupon.value) || coupon.value < 1 || coupon.value > 100) {
      return { ok: false, reason: 'Coupon percent is invalid' };
    }
    return { ok: true, discountCents: Math.min(percentOfCents(ctx.subtotalCents, coupon.value), ctx.subtotalCents) };
  }
  if (!Number.isInteger(coupon.value) || coupon.value < 1) {
    return { ok: false, reason: 'Coupon amount is invalid' };
  }
  return { ok: true, discountCents: Math.min(coupon.value, ctx.subtotalCents) };
}

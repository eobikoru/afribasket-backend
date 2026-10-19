import { Injectable } from '@nestjs/common';
import { Prisma, type ShippingMethod } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import type { UsAddress } from '../common/address';
import { resolveLines, type RequestedLine, type ResolvedLine } from '../catalog/resolve-lines';
import { CouponsService } from '../coupons/coupons.service';
import { ShippingService } from '../shipping/shipping.service';
import { TaxService } from '../tax/tax.service';

type Db = Prisma.TransactionClient | { product: Prisma.TransactionClient['product'] };

export interface PricedCheckout {
  lines: ResolvedLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: 'USD';
  shippingExplanation: string;
  taxExplanation: string;
  allowedShippingMethods: string[];
  taxState: string;
  taxRateBps: number;
  taxCalculationId: string | null;
  couponId?: string;
  couponCode?: string;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly coupons: CouponsService,
    private readonly shipping: ShippingService,
    private readonly tax: TaxService,
  ) {}

  async price(
    input: {
      lines: RequestedLine[];
      address: UsAddress;
      shippingMethod: ShippingMethod;
      couponCode?: string;
      customerId?: string;
      email?: string;
    },
    db: Db,
  ): Promise<PricedCheckout> {
    if (input.lines.length === 0) throw Errors.badRequest('Add at least one item');
    const lines = await resolveLines(db as Prisma.TransactionClient, mergeRequests(input.lines));
    const blocked = lines.find((line) => !line.purchasable);
    if (blocked) throw Errors.conflict(blocked.unavailableReason ?? 'An item is unavailable');
    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const coupon = await this.coupons.quote(
      input.couponCode,
      { subtotalCents, customerId: input.customerId, email: input.email },
      db as Prisma.TransactionClient,
    );
    const hasColdChain = lines.some((line) => line.storageType !== 'ambient');
    const weight = lines.reduce((sum, line) => sum + line.shippingWeightOz, 0);
    const shipping = await this.shipping.quote({
      subtotalCents,
      totalWeightOz: weight,
      state: input.address.state,
      hasColdChain,
      method: input.shippingMethod,
    });
    const tax = await this.tax.calculate({
      address: input.address,
      lines: lines.map((line) => ({ sku: line.sku, lineTotalCents: line.lineTotalCents, taxCode: line.taxCode })),
      shippingCents: shipping.totalCents,
      discountCents: coupon.discountCents,
    });
    const totalCents = subtotalCents - coupon.discountCents + shipping.totalCents + tax.taxCents;
    if (totalCents < 50) throw Errors.unprocessable('Order total must be at least $0.50');
    return {
      lines,
      subtotalCents,
      discountCents: coupon.discountCents,
      shippingCents: shipping.totalCents,
      taxCents: tax.taxCents,
      totalCents,
      currency: 'USD',
      shippingExplanation: shipping.explanation,
      taxExplanation: tax.explanation,
      allowedShippingMethods: shipping.allowedMethods,
      taxState: tax.state,
      taxRateBps: tax.rateBps,
      taxCalculationId: tax.calculationId,
      couponId: coupon.couponId,
      couponCode: coupon.code,
    };
  }
}

export function mergeRequests(lines: RequestedLine[]): RequestedLine[] {
  const merged = new Map<string, RequestedLine>();
  for (const line of lines) {
    const key = `${line.productId}:${line.variantId ?? ''}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { productId: line.productId, variantId: line.variantId ?? null, quantity: line.quantity });
  }
  return [...merged.values()];
}

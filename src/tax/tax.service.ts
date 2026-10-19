import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { bpsOfCents } from '../common/money';
import type { UsAddress } from '../common/address';
import { SettingsService } from '../settings/settings.service';

export interface TaxLine {
  sku: string;
  lineTotalCents: number;
  taxCode: string;
}

export interface TaxQuote {
  taxCents: number;
  rateBps: number;
  state: string;
  calculationId: string | null;
  explanation: string;
  provider: 'flat' | 'stripe';
}

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: SettingsService,
  ) {}

  async calculate(input: {
    address: UsAddress;
    lines: TaxLine[];
    shippingCents: number;
    discountCents: number;
  }): Promise<TaxQuote> {
    if (this.config.get('stripe', { infer: true }).taxEnabled) return this.stripeTax(input);
    const settings = await this.settings.get();
    const taxable = Math.max(0, sum(input.lines) - input.discountCents + input.shippingCents);
    const taxCents = bpsOfCents(taxable, settings.taxFlatRateBps);
    return {
      taxCents,
      rateBps: settings.taxFlatRateBps,
      state: input.address.state,
      calculationId: null,
      explanation: 'Estimated tax',
      provider: 'flat',
    };
  }

  private async stripeTax(input: {
    address: UsAddress;
    lines: TaxLine[];
    shippingCents: number;
    discountCents: number;
  }): Promise<TaxQuote> {
    const secret = this.config.get('stripe', { infer: true }).secretKey;
    if (!secret) throw Errors.unavailable('Stripe Tax is enabled but STRIPE_SECRET_KEY is missing');
    const stripe = new Stripe(secret);
    const discounted = distributeDiscount(input.lines.map((line) => line.lineTotalCents), input.discountCents);
    try {
      const calculation = await stripe.tax.calculations.create({
        currency: 'usd',
        customer_details: {
          address: {
            line1: input.address.line1,
            line2: input.address.line2,
            city: input.address.city,
            state: input.address.state,
            postal_code: input.address.postalCode,
            country: 'US',
          },
          address_source: 'shipping',
        },
        line_items: input.lines.map((line, index) => ({
          amount: Math.max(0, discounted[index] ?? 0),
          quantity: 1,
          reference: line.sku || `line-${index + 1}`,
          tax_code: line.taxCode,
          tax_behavior: 'exclusive',
        })),
        shipping_cost: { amount: input.shippingCents },
      });
      const taxable = Math.max(0, sum(input.lines) - input.discountCents + input.shippingCents);
      return {
        taxCents: calculation.tax_amount_exclusive,
        rateBps: effectiveBps(calculation.tax_amount_exclusive, taxable),
        state: input.address.state,
        calculationId: calculation.id,
        explanation: `Sales tax calculated by Stripe Tax for ${input.address.state}`,
        provider: 'stripe',
      };
    } catch (error) {
      this.logger.error({ msg: 'stripe_tax_failed', error: error instanceof Error ? error.message : 'unknown' });
      throw Errors.provider('Tax calculation failed');
    }
  }
}

function sum(lines: TaxLine[]): number {
  return lines.reduce((total, line) => total + line.lineTotalCents, 0);
}

export function distributeDiscount(lineTotals: number[], discountCents: number): number[] {
  const subtotal = lineTotals.reduce((total, value) => total + value, 0);
  if (discountCents <= 0 || subtotal <= 0) return [...lineTotals];
  let remaining = Math.min(discountCents, subtotal);
  return lineTotals.map((total, index) => {
    if (index === lineTotals.length - 1) return total - remaining;
    const share = Math.trunc((total * discountCents) / subtotal);
    remaining -= share;
    return total - share;
  });
}

function effectiveBps(taxCents: number, taxableCents: number): number {
  if (taxableCents <= 0) return 0;
  const numerator = taxCents * 10_000;
  const base = Math.trunc(numerator / taxableCents);
  const remainder = numerator % taxableCents;
  return remainder * 2 >= taxableCents ? base + 1 : base;
}

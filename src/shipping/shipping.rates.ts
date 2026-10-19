import { isUsState } from '../common/address';
import type { ShippingMethodName, ShippingQuote, ShippingQuoteInput, ShippingSettings, ShippingZone } from './shipping.types';

const TERRITORIES = new Set(['PR', 'GU', 'VI', 'AS', 'MP']);
const AK_HI = new Set(['AK', 'HI']);

export function resolveZone(state: string): ShippingZone | null {
  const code = state.trim().toUpperCase();
  if (!isUsState(code)) return null;
  if (TERRITORIES.has(code)) return 'territories';
  if (AK_HI.has(code)) return 'ak_hi';
  return 'contiguous';
}

export function allowedMethods(
  zone: ShippingZone,
  hasColdChain: boolean,
  settings: ShippingSettings,
): ShippingMethodName[] {
  const rates = settings.zones[zone];
  const methods: ShippingMethodName[] = ['standard', 'expedited'];
  if (rates.overnight) methods.push('overnight');
  return hasColdChain ? methods.filter((method) => method !== 'standard') : methods;
}

function billablePounds(weightOz: number): number {
  if (!Number.isFinite(weightOz) || weightOz <= 0) return 1;
  return Math.max(1, Math.ceil(weightOz / 16));
}

function rateCents(baseCents: number, perPoundCents: number, weightOz: number): number {
  const extraPounds = billablePounds(weightOz) - 1;
  return baseCents + extraPounds * perPoundCents;
}

export type ShippingResult =
  | { ok: true; quote: ShippingQuote }
  | { ok: false; code: 'OUTSIDE_US' | 'METHOD_NOT_ALLOWED'; message: string; allowedMethods: ShippingMethodName[] };

export function quoteShipping(input: ShippingQuoteInput): ShippingResult {
  const zone = resolveZone(input.state);
  if (!zone) {
    return {
      ok: false,
      code: 'OUTSIDE_US',
      message: 'AfriBasket ships to US addresses only',
      allowedMethods: [],
    };
  }
  const methods = allowedMethods(zone, input.hasColdChain, input.settings);
  if (!methods.includes(input.method)) {
    return {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: input.hasColdChain
        ? 'Refrigerated and frozen orders cannot use the slowest shipping method'
        : 'That shipping method is not available for this address',
      allowedMethods: methods,
    };
  }
  const zoneRates = input.settings.zones[zone];
  const priceOf = (method: ShippingMethodName): number => {
    const rate = zoneRates[method];
    if (!rate) return Number.POSITIVE_INFINITY;
    return rateCents(rate.baseCents, rate.perPoundCents, input.totalWeightOz);
  };
  const selected = priceOf(input.method);
  const cheapest = Math.min(...methods.map((method) => priceOf(method)));
  const free = input.subtotalCents >= input.settings.freeShippingThresholdCents;
  const shippingCents = free ? Math.max(0, selected - cheapest) : selected;
  const coldPackCents = input.hasColdChain ? input.settings.coldPackSurchargeCents : 0;
  const pounds = billablePounds(input.totalWeightOz);
  const zoneLabel =
    zone === 'contiguous' ? 'the contiguous US' : zone === 'ak_hi' ? 'Alaska or Hawaii' : 'a US territory';
  const parts = [
    `${input.method} shipping to ${zoneLabel} for ${pounds} billable lb`,
    free
      ? `free shipping applied at ${input.settings.freeShippingThresholdCents} cents subtotal on the cheapest allowed method`
      : `weight rate ${selected} cents`,
    coldPackCents > 0 ? `cold-pack surcharge ${coldPackCents} cents` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    ok: true,
    quote: {
      zone,
      method: input.method,
      shippingCents,
      coldPackCents,
      totalCents: shippingCents + coldPackCents,
      explanation: parts.join('; '),
      allowedMethods: methods,
    },
  };
}

import type { Env } from '../config/env.schema';

export type ShippingZone = 'contiguous' | 'ak_hi' | 'territories';
export type ShippingMethodName = 'standard' | 'expedited' | 'overnight';

export interface MethodRate {
  baseCents: number;
  perPoundCents: number;
}

export interface ZoneRates {
  standard: MethodRate;
  expedited: MethodRate;
  overnight: MethodRate | null;
}

export interface ShippingSettings {
  freeShippingThresholdCents: number;
  coldPackSurchargeCents: number;
  zones: Record<ShippingZone, ZoneRates>;
}

export interface ShippingQuoteInput {
  subtotalCents: number;
  totalWeightOz: number;
  state: string;
  hasColdChain: boolean;
  method: ShippingMethodName;
  settings: ShippingSettings;
}

export interface ShippingQuote {
  zone: ShippingZone;
  method: ShippingMethodName;
  shippingCents: number;
  coldPackCents: number;
  totalCents: number;
  explanation: string;
  allowedMethods: ShippingMethodName[];
}

export function shippingSettingsFromEnv(env: Env): ShippingSettings {
  return {
    freeShippingThresholdCents: env.FREE_SHIPPING_THRESHOLD_CENTS,
    coldPackSurchargeCents: env.COLD_PACK_SURCHARGE_CENTS,
    zones: {
      contiguous: {
        standard: {
          baseCents: env.SHIP_CONTIGUOUS_STANDARD_BASE_CENTS,
          perPoundCents: env.SHIP_CONTIGUOUS_STANDARD_PER_LB_CENTS,
        },
        expedited: {
          baseCents: env.SHIP_CONTIGUOUS_EXPEDITED_BASE_CENTS,
          perPoundCents: env.SHIP_CONTIGUOUS_EXPEDITED_PER_LB_CENTS,
        },
        overnight: {
          baseCents: env.SHIP_CONTIGUOUS_OVERNIGHT_BASE_CENTS,
          perPoundCents: env.SHIP_CONTIGUOUS_OVERNIGHT_PER_LB_CENTS,
        },
      },
      ak_hi: {
        standard: {
          baseCents: env.SHIP_AKHI_STANDARD_BASE_CENTS,
          perPoundCents: env.SHIP_AKHI_STANDARD_PER_LB_CENTS,
        },
        expedited: {
          baseCents: env.SHIP_AKHI_EXPEDITED_BASE_CENTS,
          perPoundCents: env.SHIP_AKHI_EXPEDITED_PER_LB_CENTS,
        },
        overnight: null,
      },
      territories: {
        standard: {
          baseCents: env.SHIP_TERRITORY_STANDARD_BASE_CENTS,
          perPoundCents: env.SHIP_TERRITORY_STANDARD_PER_LB_CENTS,
        },
        expedited: {
          baseCents: env.SHIP_TERRITORY_EXPEDITED_BASE_CENTS,
          perPoundCents: env.SHIP_TERRITORY_EXPEDITED_PER_LB_CENTS,
        },
        overnight: null,
      },
    },
  };
}

export const shippingSettingsSchemaFields = {
  freeShippingThresholdCents: true,
  coldPackSurchargeCents: true,
} as const;

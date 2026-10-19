import { quoteShipping, resolveZone } from './shipping.rates';
import type { ShippingSettings } from './shipping.types';

const settings: ShippingSettings = {
  freeShippingThresholdCents: 7500,
  coldPackSurchargeCents: 800,
  zones: {
    contiguous: {
      standard: { baseCents: 699, perPoundCents: 50 },
      expedited: { baseCents: 1499, perPoundCents: 80 },
      overnight: { baseCents: 2999, perPoundCents: 120 },
    },
    ak_hi: {
      standard: { baseCents: 1499, perPoundCents: 150 },
      expedited: { baseCents: 2999, perPoundCents: 200 },
      overnight: null,
    },
    territories: {
      standard: { baseCents: 1899, perPoundCents: 175 },
      expedited: { baseCents: 3499, perPoundCents: 225 },
      overnight: null,
    },
  },
};

function quote(overrides: Partial<Parameters<typeof quoteShipping>[0]>) {
  return quoteShipping({
    subtotalCents: 2000,
    totalWeightOz: 16,
    state: 'NY',
    hasColdChain: false,
    method: 'standard',
    settings,
    ...overrides,
  });
}

describe('shipping zones', () => {
  it('maps US states, DC, military mail, Alaska, Hawaii, and territories', () => {
    expect(resolveZone('ny')).toBe('contiguous');
    expect(resolveZone('CA')).toBe('contiguous');
    expect(resolveZone('DC')).toBe('contiguous');
    expect(resolveZone('AE')).toBe('contiguous');
    expect(resolveZone('AK')).toBe('ak_hi');
    expect(resolveZone('HI')).toBe('ak_hi');
    expect(resolveZone('PR')).toBe('territories');
    expect(resolveZone('GU')).toBe('territories');
    expect(resolveZone('ON')).toBeNull();
  });

  it('bills whole pounds and charges the contiguous rate card', () => {
    const onePound = quote({ totalWeightOz: 1 });
    const twoPounds = quote({ totalWeightOz: 17 });
    expect(onePound.ok && onePound.quote.shippingCents).toBe(699);
    expect(twoPounds.ok && twoPounds.quote.shippingCents).toBe(749);
    expect(onePound.ok && onePound.quote.zone).toBe('contiguous');
  });

  it('waives the cheapest method once the subtotal reaches the threshold', () => {
    const standard = quote({ subtotalCents: 7500, method: 'standard' });
    const expedited = quote({ subtotalCents: 7500, method: 'expedited' });
    expect(standard.ok && standard.quote.totalCents).toBe(0);
    expect(expedited.ok && expedited.quote.shippingCents).toBe(800);
  });

  it('rejects overnight outside the contiguous US and rejects non-US addresses', () => {
    const alaska = quote({ state: 'AK', method: 'overnight' });
    const territory = quote({ state: 'VI', method: 'standard', totalWeightOz: 32 });
    const abroad = quote({ state: 'ON' });
    expect(alaska.ok).toBe(false);
    if (!alaska.ok) expect(alaska.allowedMethods).toEqual(['standard', 'expedited']);
    expect(territory.ok && territory.quote.zone).toBe('territories');
    expect(territory.ok && territory.quote.shippingCents).toBe(1899 + 175);
    expect(abroad.ok).toBe(false);
    if (!abroad.ok) expect(abroad.code).toBe('OUTSIDE_US');
  });

  it('keeps frozen orders off the slowest method and adds the cold-pack surcharge', () => {
    const refused = quote({ hasColdChain: true, method: 'standard' });
    const allowed = quote({ hasColdChain: true, method: 'expedited', subtotalCents: 8000 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('METHOD_NOT_ALLOWED');
    expect(allowed.ok && allowed.quote.shippingCents).toBe(0);
    expect(allowed.ok && allowed.quote.coldPackCents).toBe(800);
    expect(allowed.ok && allowed.quote.totalCents).toBe(800);
  });
});

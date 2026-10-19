/** Integer cents. Values stay inside Number.MAX_SAFE_INTEGER for grocery totals. */
export type Cents = number;

export const CURRENCY = 'USD' as const;

export function assertCents(value: number, label = 'amount'): asserts value is Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents`);
  }
}

export function percentOfCents(amountCents: number, percent: number): Cents {
  if (!Number.isInteger(amountCents) || !Number.isInteger(percent)) {
    throw new Error('percentOfCents requires integer cents and an integer percent');
  }
  const numerator = amountCents * percent;
  const base = Math.trunc(numerator / 100);
  const remainder = Math.abs(numerator % 100);
  if (remainder >= 50) {
    return base + (numerator >= 0 ? 1 : -1);
  }
  return base;
}

export function bpsOfCents(amountCents: number, basisPoints: number): Cents {
  if (!Number.isInteger(amountCents) || !Number.isInteger(basisPoints)) {
    throw new Error('bpsOfCents requires integers');
  }
  const numerator = amountCents * basisPoints;
  const base = Math.trunc(numerator / 10_000);
  const remainder = Math.abs(numerator % 10_000);
  if (remainder >= 5_000) {
    return base + (numerator >= 0 ? 1 : -1);
  }
  return base;
}

/** Formats cents as a PayPal/Stripe decimal string without floating-point money math. */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')}`;
}

export function decimalStringToCents(value: string): Cents {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid decimal money value: ${value}`);
  }
  const sign = match[1] ? -1 : 1;
  const dollars = Number(match[2]);
  const fraction = (match[3] ?? '').padEnd(2, '0');
  return sign * (dollars * 100 + Number(fraction));
}

export function formatUsd(cents: number): string {
  const negative = cents < 0;
  const text = centsToDecimalString(Math.abs(cents));
  return `${negative ? '-' : ''}$${text}`;
}

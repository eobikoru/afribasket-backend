import { bpsOfCents, centsToDecimalString, decimalStringToCents, percentOfCents } from './money';

describe('money', () => {
  it('formats cents as a decimal string without binary float math', () => {
    expect(centsToDecimalString(0)).toBe('0.00');
    expect(centsToDecimalString(1)).toBe('0.01');
    expect(centsToDecimalString(7500)).toBe('75.00');
    expect(centsToDecimalString(1099)).toBe('10.99');
    expect(centsToDecimalString(-250)).toBe('-2.50');
  });

  it('parses decimal strings back to cents', () => {
    expect(decimalStringToCents('75.00')).toBe(7500);
    expect(decimalStringToCents('10.9')).toBe(1090);
    expect(decimalStringToCents('3')).toBe(300);
    expect(decimalStringToCents('-2.50')).toBe(-250);
  });

  it('rounds percent and basis-point shares half up using integers', () => {
    expect(percentOfCents(1999, 10)).toBe(200);
    expect(percentOfCents(100, 15)).toBe(15);
    expect(bpsOfCents(10000, 825)).toBe(825);
    expect(bpsOfCents(333, 1000)).toBe(33);
  });
});

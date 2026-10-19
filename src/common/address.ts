import { z } from 'zod';

export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
  'WY', 'PR', 'GU', 'VI', 'AS', 'MP', 'AA', 'AE', 'AP',
] as const;

const STATE_SET = new Set<string>(US_STATE_CODES);

export function isUsState(value: string): boolean {
  return STATE_SET.has(value.toUpperCase());
}

export const usPhoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .transform((value, ctx) => {
    const digits = value.replace(/\D/g, '');
    const normalized = digits.length === 10 ? `1${digits}` : digits;
    if (normalized.length !== 11 || !normalized.startsWith('1')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid US phone number' });
      return z.NEVER;
    }
    return `+${normalized}`;
  });

export const usAddressSchema = z.object({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(80),
  state: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine(isUsState, 'Use a US state, DC, or territory code'),
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, 'Use a ZIP or ZIP+4 code'),
  country: z.literal('US').default('US'),
  phone: usPhoneSchema.optional(),
});

export type UsAddress = z.infer<typeof usAddressSchema>;

export function assertUsCountry(country: string | undefined): void {
  if (country && country.toUpperCase() !== 'US') {
    throw new Error('OUTSIDE_US');
  }
}
